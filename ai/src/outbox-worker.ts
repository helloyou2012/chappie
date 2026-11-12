/**
 * Outbox worker —— 设计方案 §26.3 消费约定：
 *   FOR UPDATE SKIP LOCKED 批量认领；会话粒度 PG 咨询锁保序；
 *   失败 attempts 递增退避，超过上限丢弃并告警；过期任务直接丢弃。
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { CardPayload, MemberSnapshot, Message } from '@chappie/contract';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { resumeFromApproval } from './agent-runtime';
import { client, db } from './common/db';
import { internal } from './common/internal';
import { parseJsonSafe } from './common/json';
import { log, newId } from './common/log';
import { aiKeys, redisDel, redisSetEx } from './common/redis';
import {
  agentTask,
  avatar as avatarTable,
  capability,
  capabilityGrant,
  feedback,
  memoryItem,
  message as messageTable,
  outbox,
  policy as policyTable,
  schedulerJob,
  styleProfile,
} from './db/schema';
import { processMessageCreated } from './pipeline';

const WORKER_ID = `worker_${uuidv4().slice(0, 8)}`;
const BATCH = 20;
const LOCK_TIMEOUT_SECONDS = 30;
const MAX_ATTEMPTS = 10;

interface OutboxRow {
  id: number;
  topic: string;
  key: string | null;
  payload: {
    eventId: string;
    topic: string;
    key: string | null;
    traceId: string | null;
    occurredAt: string;
    data: unknown;
  };
  attempts: number;
}

export async function runOutboxWorker(signal?: AbortSignal): Promise<void> {
  log.info('outbox worker started', { worker: WORKER_ID });
  while (!signal?.aborted) {
    try {
      const rows = (await db.transaction(async (tx) => {
        const candidates = await tx
          .select({ id: outbox.id })
          .from(outbox)
          .where(
            and(
              isNull(outbox.doneAt),
              or(
                isNull(outbox.lockedAt),
                sql`${outbox.lockedAt} < now() - ${`${LOCK_TIMEOUT_SECONDS} seconds`}::interval`,
              ),
              lt(outbox.attempts, MAX_ATTEMPTS),
            ),
          )
          .orderBy(asc(outbox.id))
          .limit(BATCH)
          .for('update', { skipLocked: true });
        if (candidates.length === 0) return [];
        return tx
          .update(outbox)
          .set({
            lockedAt: sql`now()`,
            lockedBy: WORKER_ID,
            attempts: sql`${outbox.attempts} + 1`,
          })
          .where(
            inArray(
              outbox.id,
              candidates.map((c) => c.id),
            ),
          )
          .returning();
      })) as unknown as OutboxRow[];

      if (rows.length === 0) {
        await sleep(400);
        continue;
      }

      for (const row of rows) {
        await processRow(row);
      }
    } catch (e) {
      log.error('outbox worker loop error', { error: String(e) });
      await sleep(2000);
    }
  }
  log.info('outbox worker stopped');
}

async function processRow(row: OutboxRow): Promise<void> {
  // 会话/用户粒度咨询锁：同一 key 的事件串行处理（多实例安全）
  const lockKey = row.key ?? `outbox:${row.id}`;
  const reserved = await client.reserve();
  try {
    const lockResult = (await reserved`
      SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
    `) as unknown as { locked: boolean }[];
    if (!lockResult[0]?.locked) {
      // 其他 worker 正在处理同 key 事件：下轮再试（locked_at 超时后重新可见）
      return;
    }
    try {
      await dispatch(row);
      await db.update(outbox).set({ doneAt: sql`now()` }).where(eq(outbox.id, row.id));
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${lockKey}))`.catch(() => undefined);
    }
  } catch (e) {
    const attempts = row.attempts ?? 1;
    log.error('outbox event failed', {
      id: row.id,
      topic: row.topic,
      attempts,
      error: String(e).slice(0, 500),
    });
    if (attempts >= MAX_ATTEMPTS) {
      // 超过上限：标记完成（进入死信语义）+ 告警日志
      await db
        .update(outbox)
        .set({ doneAt: sql`now()` })
        .where(eq(outbox.id, row.id))
        .catch(() => undefined);
      log.error('outbox event dead-lettered', { id: row.id, topic: row.topic });
    }
    // 否则保留 locked_at，30 秒后重试（指数退避由 attempts 与锁定超时共同近似）
  } finally {
    reserved.release();
  }
}

// ---------------------------------------------------------------------------
// 事件分发
// ---------------------------------------------------------------------------

async function dispatch(row: OutboxRow): Promise<void> {
  // Bun.sql 可能把 JSONB 返回为字符串；统一宽容解析
  const payload =
    typeof row.payload === 'string'
      ? parseJsonSafe<OutboxRow['payload']>(row.payload as unknown as string)
      : row.payload;
  if (!payload) throw new Error(`outbox #${row.id} payload 无法解析`);
  const topic = row.topic || payload.topic;
  const data = (payload.data ?? {}) as Record<string, unknown>;

  switch (topic) {
    case 'user.created':
      await handleUserCreated(data as { userId: string; email: string; name: string });
      break;
    case 'message.created':
      await processMessageCreated(data as { message: Message; members: MemberSnapshot[] });
      break;
    case 'message.recalled':
      await handleMessageRecalled(data as { msgId: string; convId: string; actorId: string });
      break;
    case 'policy.changed':
      await handlePolicyChanged(data as { userId: string; convId: string | null });
      break;
    case 'card.action':
      await handleCardAction(
        data as {
          msgId: string;
          convId: string;
          actorId: string;
          action: string;
          editedText?: string;
          card: CardPayload;
        },
      );
      break;
    case 'feedback.submitted':
      await handleFeedback(
        data as {
          msgId: string;
          convId: string;
          actorId: string;
          feedbackType: string;
          correctedText?: string;
          reason?: string;
        },
      );
      break;
    case 'takeover.requested':
      await handleTakeover(data as { userId: string; convId: string });
      break;
    default:
      log.warn('unknown outbox topic', { topic });
  }
}

// ---------------------------------------------------------------------------
// user.created：创建分身 + 默认策略 + 分身会话 + 能力授权 + 日报计划
// ---------------------------------------------------------------------------

async function handleUserCreated(data: {
  userId: string;
  email: string;
  name: string;
}): Promise<void> {
  // 幂等：已存在则跳过
  const existing = await db
    .select({ id: avatarTable.id })
    .from(avatarTable)
    .where(eq(avatarTable.ownerId, data.userId))
    .limit(1);
  if (existing.length > 0) return;

  const { avatarId } = await internal.createAvatar(data.userId, `${data.name} 的分身`);
  await db.insert(avatarTable).values({
    id: avatarId,
    ownerId: data.userId,
    name: `${data.name} 的分身`,
    persona: `你是 ${data.name} 的 AI 分身。语气自然、简洁、友好，回复尽量不超过三句话，适度使用表情符号。`,
    modelProfile: 'default',
    status: 'active',
    dailyBudgetUsd: '1.0',
  });

  // 默认全局策略：新手从手动档开始（设计方案 §12 新手引导）
  await db.insert(policyTable).values({
    id: newId('p'),
    ownerId: data.userId,
    scopeType: 'global',
    scopeId: null,
    name: '默认策略',
    rule: {
      mode: 'manual',
      schedule: [],
      allowCapabilities: null,
      denyTopics: ['money'],
      maxRisk: 'L1',
      rateLimitPerHour: 20,
      escalateWhen: ['confidence<0.7'],
    },
    priority: 0,
  });

  // 分身会话（主人 ↔ 分身，控制通道）
  const { convId } = await internal.createConversation({
    type: 'direct',
    memberPrincipalIds: [data.userId, avatarId],
    systemTag: 'avatar_self',
  });
  await db.update(avatarTable).set({ selfConvId: convId }).where(eq(avatarTable.id, avatarId));

  // 能力授权：内置全部授予（风险约束在 tool-gateway 内执行）
  const caps = await db.select({ id: capability.id }).from(capability);
  for (const cap of caps) {
    await db
      .insert(capabilityGrant)
      .values({ avatarId, capabilityId: cap.id, granted: true })
      .onConflictDoNothing();
  }

  // 分身日报（每天 09:00）
  await db
    .insert(schedulerJob)
    .values({
      id: newId('sj'),
      avatarId,
      kind: 'daily_report',
      schedule: '09:00',
      enabled: true,
    })
    .onConflictDoNothing();

  // 风格画像初始化
  await db
    .insert(styleProfile)
    .values({
      avatarId,
      features: { tone: '友好简洁', avgLength: '短', emoji: '适度', catchphrases: [] },
      examples: [],
    })
    .onConflictDoNothing();

  log.info('avatar provisioned', { userId: data.userId, avatarId, selfConvId: convId });
}

// ---------------------------------------------------------------------------
// 其它事件
// ---------------------------------------------------------------------------

async function handleMessageRecalled(data: { msgId: string }): Promise<void> {
  // 撤销记忆引用（设计方案 §28.1：message.recalled → memory 撤销引用）
  await db
    .delete(memoryItem)
    .where(eq(memoryItem.sourceMsgId, data.msgId))
    .catch(() => undefined);
}

async function handlePolicyChanged(data: { userId: string }): Promise<void> {
  const rows = await db
    .select({ id: avatarTable.id })
    .from(avatarTable)
    .where(eq(avatarTable.ownerId, data.userId));
  for (const r of rows) await redisDel(aiKeys.policy(r.id));
}

async function handleCardAction(data: {
  msgId: string;
  convId: string;
  actorId: string;
  action: string;
  editedText?: string;
  card: CardPayload;
}): Promise<void> {
  const card = data.card;
  switch (card.kind) {
    case 'draft':
      await handleDraftAction(data.actorId, card, data.action, data.editedText);
      break;
    case 'approval':
      await handleApprovalAction(data.actorId, card, data.action, data.editedText);
      break;
    case 'task':
      if (data.action === 'cancel') {
        await db
          .update(agentTask)
          .set({ status: 'cancelled', error: '主人取消任务', updatedAt: sql`now()` })
          .where(
            and(
              eq(agentTask.id, card.taskId),
              sql`${agentTask.status} NOT IN ('completed', 'cancelled', 'failed')`,
            ),
          );
      }
      break;
    default:
      break;
  }
}

async function handleDraftAction(
  actorId: string,
  card: Extract<CardPayload, { kind: 'draft' }>,
  action: string,
  editedText?: string,
): Promise<void> {
  const avatarRows = await db
    .select({ id: avatarTable.id, ownerId: avatarTable.ownerId })
    .from(avatarTable)
    .where(eq(avatarTable.ownerId, actorId))
    .limit(1);
  const avatar = avatarRows[0];
  if (!avatar) return;

  if (action === 'discard') {
    await db
      .update(agentTask)
      .set({
        status: 'completed',
        decision: { action: 'discard', reason: '主人丢弃草稿', confidence: 0 },
        updatedAt: sql`now()`,
      })
      .where(eq(agentTask.id, card.taskId));
    await db
      .insert(feedback)
      .values({
        msgId: card.taskId,
        taskId: card.taskId,
        actor: actorId,
        type: 'reject',
        reason: '丢弃草稿',
      })
      .catch(() => undefined);
    return;
  }

  const text = action === 'edit' ? (editedText ?? card.draftText) : card.draftText;
  const sent = await internal.sendMessage({
    clientMsgId: newId('draft'),
    convId: card.targetConvId,
    senderId: avatar.id,
    onBehalfOf: actorId,
    content: { type: 'text', schemaVersion: 1, text },
    mentions: [],
    replyTo: card.replyToMsgId,
    aiMeta: {
      taskId: card.taskId,
      mode: 'draft',
      toolsUsed: [],
      risk: 'L0',
      confidence: 1,
      hopCount: 1,
      explanation: {
        decision: 'reply',
        reason: action === 'edit' ? '主人修改后发送草稿' : '主人直接发送草稿',
        confidence: 1,
        toolsUsed: [],
        memoriesUsed: [],
      },
    },
  });

  await db
    .update(agentTask)
    .set({
      status: 'completed',
      result: text,
      decision: {
        action: action === 'edit' ? 'edited_sent' : 'sent',
        reason: '主人确认草稿',
        confidence: 1,
      },
      updatedAt: sql`now()`,
    })
    .where(eq(agentTask.id, card.taskId));
  await db
    .insert(feedback)
    .values({
      msgId: sent.msgId,
      taskId: card.taskId,
      actor: actorId,
      type: 'accept',
      diff: action === 'edit' ? (editedText ?? null) : null,
    })
    .catch(() => undefined);
  log.info('draft handled', { taskId: card.taskId, action, msgId: sent.msgId });
}

async function handleApprovalAction(
  actorId: string,
  card: Extract<CardPayload, { kind: 'approval' }>,
  action: string,
  editedText?: string,
): Promise<void> {
  if (action === 'approve' || action === 'modify_approve' || action === 'reject') {
    await resumeFromApproval(
      card.approvalId,
      action as 'approve' | 'modify_approve' | 'reject',
      editedText,
      actorId,
    );
  }
}

async function handleFeedback(data: {
  msgId: string;
  convId: string;
  actorId: string;
  feedbackType: string;
  correctedText?: string;
  reason?: string;
}): Promise<void> {
  const taskRows = await db
    .select({ taskId: sql<string | null>`${messageTable.aiMeta}->>'taskId'` })
    .from(messageTable)
    .where(eq(messageTable.msgId, data.msgId))
    .limit(1);
  const taskId = taskRows[0]?.taskId ?? null;

  await db.insert(feedback).values({
    msgId: data.msgId,
    taskId,
    actor: data.actorId,
    type: data.feedbackType,
    diff: data.correctedText ?? null,
    reason: data.reason ?? null,
  });

  // 纠正内容 → 偏好记忆（反馈闭环 —— 设计方案 §9.3）
  if (data.feedbackType === 'correct' && data.correctedText) {
    const avatarRows = await db
      .select({ id: avatarTable.id })
      .from(avatarTable)
      .where(eq(avatarTable.ownerId, data.actorId))
      .limit(1);
    const avatarId = avatarRows[0]?.id;
    if (avatarId) {
      await db
        .insert(memoryItem)
        .values({
          id: newId('mem'),
          avatarId,
          scope: 'global',
          type: 'preference',
          content: `回复偏好：${data.correctedText.slice(0, 200)}`,
          keywords: ['偏好', '回复', '语气'],
          sensitivity: 'normal',
          confidence: 0.9,
        })
        .catch(() => undefined);
    }
  }
}

async function handleTakeover(data: { userId: string; convId: string }): Promise<void> {
  const cancelled = await db
    .update(agentTask)
    .set({
      status: 'handed_over',
      decision: { action: 'takeover', reason: '主人接管', confidence: 1 },
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(agentTask.ownerId, data.userId),
        eq(agentTask.triggerConvId, data.convId),
        sql`${agentTask.status} IN ('created', 'planning', 'running', 'waiting_approval', 'waiting_user_input')`,
      ),
    )
    .returning({ id: agentTask.id });

  // 话题冷却 15 分钟（设计方案 §4.3）
  await redisSetEx(aiKeys.cooldown(data.convId, data.userId), '1', 15 * 60);

  if (cancelled.length > 0) {
    await internal
      .pushCard(data.userId, {
        kind: 'handover',
        taskId: cancelled[0].id,
        summary: `你已接管该会话，分身暂停 ${cancelled.length} 个进行中的任务，并冷却 15 分钟。`,
        reason: '主人接管',
      })
      .catch(() => undefined);
  }
  log.info('takeover handled', {
    userId: data.userId,
    convId: data.convId,
    cancelled: cancelled.length,
  });
}
