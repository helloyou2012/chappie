/**
 * 事件处理流水线 —— 设计方案 §27.3：
 * message.created → router（候选分身）→ policy（档位/让位/限流）→
 * classifier（意图）→ agent-task 建立 → agent-runtime 执行。
 *
 * driveTask 持任务租约执行（task-lease）；崩溃后由 recovery.ts 认领续跑 —— 设计方案 §27.4。
 */

import type { MemberSnapshot, Message } from '@chappie/contract';
import { and, eq, sql } from 'drizzle-orm';
import { runAgent } from './agent-runtime';
import { type Classification, classify } from './classifier';
import { config } from './common/config';
import { db } from './common/db';
import { log, newId, newTraceId } from './common/log';
import { aiKeys, redisSemaphoreAcquire, redisSemaphoreRelease, redisSetNx } from './common/redis';
import { LEASE_TTL_S, LeaseLostError, RUNTIME_ID, withLease } from './common/task-lease';
import { agentTask, conversation, user } from './db/schema';
import { evaluatePolicy } from './policy';
import { findCandidates } from './router';
import { shouldStaySilent } from './silence';
import { redactSecrets } from './trust';

/** 恢复重驱时分身并发已满：由 recovery 下个 tick 重试（区别于普通路径的 skip） */
export class SemaphoreFullError extends Error {
  constructor(taskId: string) {
    super(`avatar concurrency full while recovering task ${taskId}`);
    this.name = 'SemaphoreFullError';
  }
}

export async function processMessageCreated(data: {
  message: Message;
  members: MemberSnapshot[];
}): Promise<void> {
  const { message, members } = data;

  if (message.senderType === 'system') return;
  // 卡片消息（分身发出的通知）不触发新链路
  if (message.content.type === 'card') return;

  const convRows = await db
    .select({ id: conversation.id, type: conversation.type, systemTag: conversation.systemTag })
    .from(conversation)
    .where(eq(conversation.id, message.convId))
    .limit(1);
  const conv = convRows[0];
  if (!conv) return;

  const text = message.content.type === 'text' ? message.content.text : '';
  const classification = classify(text);
  const candidates = findCandidates(message, members, {
    id: conv.id,
    type: conv.type,
    systemTag: conv.systemTag,
  });
  if (candidates.length === 0) return;

  for (const candidate of candidates) {
    // 快速去重（PG 唯一键兜底 —— 设计方案 §26.3）
    if (!(await redisSetNx(aiKeys.dedup(message.msgId, candidate.avatarId), 600))) continue;
    void processCandidate({ message, classification, candidate }).catch((e) =>
      log.error('processCandidate failed', {
        msgId: message.msgId,
        avatarId: candidate.avatarId,
        error: String(e),
      }),
    );
  }
}

async function processCandidate(params: {
  message: Message;
  classification: Classification;
  candidate: { avatarId: string; ownerId: string; mentioned: boolean; via: string };
}): Promise<void> {
  const { message, classification, candidate } = params;

  // 幂等建立任务（UNIQUE(trigger_msg_id, avatar_id)）
  const taskId = newId('t');
  const traceId = newTraceId();
  const inserted = await db
    .insert(agentTask)
    .values({
      id: taskId,
      avatarId: candidate.avatarId,
      ownerId: candidate.ownerId,
      triggerMsgId: message.msgId,
      triggerConvId: message.convId,
      triggerKind: candidate.via,
      status: 'created',
      traceId,
    })
    .onConflictDoNothing({ target: [agentTask.triggerMsgId, agentTask.avatarId] })
    .returning({ id: agentTask.id });
  if (inserted.length === 0) return;

  await driveTask(
    {
      taskId,
      avatarId: candidate.avatarId,
      ownerId: candidate.ownerId,
      triggerMsgId: message.msgId,
      triggerConvId: message.convId,
      triggerKind: candidate.via,
      traceId,
    },
    message,
    { classification },
  );
}

/**
 * 驱动一个已落库的任务：策略 → 意图过滤 → 并发限制 → 租约 → runAgent。
 * 正常链路（processCandidate）与崩溃恢复（recovery.ts 分支 C）共用；
 * 恢复模式下策略/审批护栏全部重新生效。
 */
export async function driveTask(
  task: {
    taskId: string;
    avatarId: string;
    ownerId: string;
    triggerMsgId: string;
    triggerConvId: string;
    triggerKind: string;
    traceId: string;
  },
  trigger: Message,
  opts?: { classification?: Classification; recovery?: boolean },
): Promise<void> {
  const classification =
    opts?.classification ?? classify(trigger.content.type === 'text' ? trigger.content.text : '');

  const convRows = await db
    .select({ id: conversation.id, type: conversation.type, systemTag: conversation.systemTag })
    .from(conversation)
    .where(eq(conversation.id, task.triggerConvId))
    .limit(1);
  const conv = convRows[0];
  if (!conv) return;

  const mentioned = trigger.mentions?.includes(task.avatarId) ?? false;

  const skip = async (reason: string, extra?: Record<string, unknown>) => {
    await db
      .update(agentTask)
      .set({
        status: 'skipped',
        decision: { action: 'skip', reason, confidence: 0, ...extra },
        lockedBy: null,
        leaseUntil: null,
        updatedAt: sql`now()`,
      })
      .where(eq(agentTask.id, task.taskId));
    log.info('task skipped', { taskId: task.taskId, avatarId: task.avatarId, reason });
  };

  // 策略求值
  const policy = await evaluatePolicy({
    avatarId: task.avatarId,
    ownerId: task.ownerId,
    conv: { id: conv.id, type: conv.type, systemTag: conv.systemTag },
    senderType: trigger.senderType,
    senderUserId: trigger.senderType === 'human' ? trigger.senderId : null,
    mentioned,
    via: task.triggerKind as 'mention' | 'direct' | 'auto' | 'self_chat',
    triggerMessageId: task.triggerMsgId,
    classification,
  });
  if (!policy.allow) {
    await skip(policy.reason, { escalate: policy.escalate, downgraded: policy.downgraded });
    // 禁区话题 → 提示主人一次
    if (policy.escalate) {
      const { internal } = await import('./common/internal');
      await internal
        .pushCard(task.ownerId, {
          kind: 'handover',
          taskId: task.taskId,
          summary: `有一条消息触及你的禁区策略（${policy.reason}），已转交你处理。`,
          reason: policy.reason,
        })
        .catch(() => undefined);
    }
    return;
  }

  // 意图过滤：自动档只处理需要回应的消息（成本关键 —— 设计方案 §14）
  if (!classification.needReply && !mentioned && conv.systemTag !== 'avatar_self') {
    await skip('意图分类判定无需回应');
    return;
  }

  // 合理沉默：群聊 auto 档、未被 @、低置信度时不打扰
  if (
    config.silenceMinConfidence > 0 &&
    conv.type === 'group' &&
    conv.systemTag !== 'avatar_self' &&
    policy.mode === 'auto' &&
    !mentioned &&
    classification.needReply &&
    classification.confidence < config.silenceMinConfidence
  ) {
    const ownerRows = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, task.ownerId))
      .limit(1);
    const text = trigger.content.type === 'text' ? trigger.content.text : '';
    if (
      shouldStaySilent({
        convType: conv.type,
        systemTag: conv.systemTag,
        mode: policy.mode,
        mentioned,
        mentionsOwner: trigger.mentions?.includes(task.ownerId) ?? false,
        senderId: trigger.senderId,
        ownerId: task.ownerId,
        hasReply: Boolean(trigger.replyTo),
        urgency: classification.urgency,
        sentiment: classification.sentiment,
        topics: classification.topics,
        text,
        ownerName: ownerRows[0]?.name ?? null,
        needReply: classification.needReply,
        confidence: classification.confidence,
        threshold: config.silenceMinConfidence,
      })
    ) {
      await skip('低置信度选择沉默', {
        intent: classification.intent,
        intentConfidence: classification.confidence,
        silence: true,
      });
      return;
    }
  }

  // 分身并发限制（每分身 2 个并发任务）
  const semKey = aiKeys.semAvatar(task.avatarId);
  if (!(await redisSemaphoreAcquire(semKey, 2, 180))) {
    if (opts?.recovery) throw new SemaphoreFullError(task.taskId);
    await skip('分身并发任务已满，稍后处理');
    return;
  }

  try {
    // 条件迁移 + 租约：0 行 = 已被恢复进程认领/状态变更，本侧让位
    const moved = await db
      .update(agentTask)
      .set({
        status: 'planning',
        lockedBy: RUNTIME_ID,
        leaseUntil: sql`now() + ${LEASE_TTL_S} * interval '1 second'`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(agentTask.id, task.taskId), eq(agentTask.status, 'created')))
      .returning({ id: agentTask.id });
    if (moved.length === 0) return;

    await withLease(task.taskId, () =>
      runAgent({
        avatarId: task.avatarId,
        ownerId: task.ownerId,
        taskId: task.taskId,
        convId: task.triggerConvId,
        trigger,
        mode: policy.mode,
        allowCapabilities: policy.allowCapabilities,
        maxRisk: policy.maxRisk,
        classification,
        traceId: task.traceId,
        convType: conv.type as 'direct' | 'group',
      }),
    );
  } catch (e) {
    if (e instanceof LeaseLostError) {
      // 租约被恢复进程夺走：新主人正在驱动任务，本侧静默退出、不写状态
      log.warn('lease lost during task run', { taskId: task.taskId });
      return;
    }
    log.error('agent run failed', { taskId: task.taskId, error: redactSecrets(String(e)) });
    await db
      .update(agentTask)
      .set({
        status: 'failed',
        error: redactSecrets(String(e)).slice(0, 500),
        updatedAt: sql`now()`,
      })
      .where(eq(agentTask.id, task.taskId))
      .catch(() => undefined);
  } finally {
    await redisSemaphoreRelease(semKey);
  }
}
