/**
 * 事件处理流水线 —— 设计方案 §27.3：
 * message.created → router（候选分身）→ policy（档位/让位/限流）→
 * classifier（意图）→ agent-task 建立 → agent-runtime 执行。
 */

import type { MemberSnapshot, Message } from '@chappie/contract';
import { eq, sql } from 'drizzle-orm';
import { runAgent } from './agent-runtime';
import { classify } from './classifier';
import { db } from './common/db';
import { log, newId, newTraceId } from './common/log';
import { aiKeys, redisSemaphoreAcquire, redisSemaphoreRelease, redisSetNx } from './common/redis';
import { agentTask, conversation } from './db/schema';
import { evaluatePolicy } from './policy';
import { findCandidates } from './router';

/** 会话行（core 表只读） */
type ConvRow = { id: string; type: string; systemTag: string | null };

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
    void processCandidate({ message, conv, classification, candidate, members }).catch((e) =>
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
  conv: ConvRow;
  classification: ReturnType<typeof classify>;
  candidate: { avatarId: string; ownerId: string; mentioned: boolean; via: string };
  members: MemberSnapshot[];
}): Promise<void> {
  const { message, conv, classification, candidate } = params;

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

  const skip = async (reason: string, extra?: Record<string, unknown>) => {
    await db
      .update(agentTask)
      .set({
        status: 'skipped',
        decision: { action: 'skip', reason, confidence: 0, ...extra },
        updatedAt: sql`now()`,
      })
      .where(eq(agentTask.id, taskId));
    log.info('task skipped', { taskId, avatarId: candidate.avatarId, reason });
  };

  // 策略求值
  const policy = await evaluatePolicy({
    avatarId: candidate.avatarId,
    ownerId: candidate.ownerId,
    conv: { id: conv.id, type: conv.type, systemTag: conv.systemTag },
    senderType: message.senderType,
    senderUserId: message.senderType === 'human' ? message.senderId : null,
    mentioned: candidate.mentioned,
    via: candidate.via as 'mention' | 'direct' | 'auto' | 'self_chat',
    triggerMessageId: message.msgId,
    classification,
  });
  if (!policy.allow) {
    await skip(policy.reason, { escalate: policy.escalate, downgraded: policy.downgraded });
    // 禁区话题 → 提示主人一次
    if (policy.escalate) {
      const { internal } = await import('./common/internal');
      await internal
        .pushCard(candidate.ownerId, {
          kind: 'handover',
          taskId,
          summary: `有一条消息触及你的禁区策略（${policy.reason}），已转交你处理。`,
          reason: policy.reason,
        })
        .catch(() => undefined);
    }
    return;
  }

  // 意图过滤：自动档只处理需要回应的消息（成本关键 —— 设计方案 §14）
  if (!classification.needReply && !candidate.mentioned && conv.systemTag !== 'avatar_self') {
    await skip('意图分类判定无需回应');
    return;
  }

  // 分身并发限制（每分身 2 个并发任务）
  const semKey = aiKeys.semAvatar(candidate.avatarId);
  if (!(await redisSemaphoreAcquire(semKey, 2, 180))) {
    await skip('分身并发任务已满，稍后处理');
    return;
  }

  try {
    await db
      .update(agentTask)
      .set({ status: 'planning', updatedAt: sql`now()` })
      .where(eq(agentTask.id, taskId));
    await runAgent({
      avatarId: candidate.avatarId,
      ownerId: candidate.ownerId,
      taskId,
      convId: message.convId,
      trigger: message,
      mode: policy.mode,
      allowCapabilities: policy.allowCapabilities,
      maxRisk: policy.maxRisk,
      classification,
      traceId,
    });
  } catch (e) {
    log.error('agent run failed', { taskId, error: String(e) });
    await db
      .update(agentTask)
      .set({ status: 'failed', error: String(e).slice(0, 500), updatedAt: sql`now()` })
      .where(eq(agentTask.id, taskId))
      .catch(() => undefined);
  } finally {
    await redisSemaphoreRelease(semKey);
  }
}
