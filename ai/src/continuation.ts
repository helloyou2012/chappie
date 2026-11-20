/**
 * 长程任务续驱 —— 设计方案 §7.3「异步任务」/ §27.4 分段执行：
 *   agent-runtime 单段预算（AI_MAX_TOOL_ROUNDS 轮 / AI_TASK_SEGMENT_MAX_S 秒）用尽
 *   且工作未完成时，任务挂起为 waiting_continuation；本模块由 scheduler 高频扫描：
 *     1. 整体护栏先行：时限（AI_LONG_TASK_MAX_S）、最大段数、日预算 → 超出任一即转交主人收尾；
 *     2. 条件认领（waiting_continuation → running + 租约），多实例安全，0 行即让位；
 *     3. 从 checkpoint 恢复 runAgent 续跑——撤权 / 审批 / 幂等账本护栏在 runAgent 内重新生效。
 *
 * 与 recovery.ts 的分工：recovery 处理「异常中断」（租约过期 = worker 崩溃）；
 * 本模块处理「正常挂起」（预算分段的主动暂停）。
 */

import { and, eq, or, sql } from 'drizzle-orm';
import type { ResumeCheckpoint } from './agent-runtime';
import { finishContinuationCard, loadTriggerMessage, runAgent } from './agent-runtime';
import { classify } from './classifier';
import { appendAudit } from './common/audit';
import { config } from './common/config';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { log, newId } from './common/log';
import { aiKeys, redisSemaphoreAcquire, redisSemaphoreRelease } from './common/redis';
import { LEASE_TTL_S, LeaseLostError, RUNTIME_ID, withLease } from './common/task-lease';
import { agentTask, avatar as avatarTable, conversation } from './db/schema';
import { todayCost } from './model-gateway';
import { redactSecrets } from './trust';

// ---------------------------------------------------------------------------
// 护栏判定（纯函数，供测试）
// ---------------------------------------------------------------------------

export interface ContinuationGuardInput {
  /** 任务创建至今的毫秒数 */
  ageMs: number;
  /** 已执行的段数（context.continuation.segmentCount） */
  segmentCount: number;
  /** 分身今日已花费（美元） */
  costUsd: number;
  /** 分身日预算（美元）；0 = 不设预算限制 */
  budgetUsd: number;
}

export type ContinuationGuard = { ok: true } | { ok: false; reason: string };

export function evaluateContinuationGuard(
  input: ContinuationGuardInput,
  limits: { maxAgeMs: number; maxSegments: number },
): ContinuationGuard {
  if (input.ageMs > limits.maxAgeMs) {
    return { ok: false, reason: '任务超出整体时限，已停止续跑' };
  }
  if (input.segmentCount >= limits.maxSegments) {
    return { ok: false, reason: '任务达到最大执行段数，已停止续跑' };
  }
  if (input.budgetUsd > 0 && input.costUsd >= input.budgetUsd) {
    return { ok: false, reason: '分身日预算已用完，任务暂停续跑' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 清扫与续驱
// ---------------------------------------------------------------------------

interface ContinuationRow {
  id: string;
  avatarId: string;
  ownerId: string;
  triggerMsgId: string | null;
  triggerConvId: string | null;
  traceId: string | null;
  context: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 续跑连续失败上限：达到即停止，避免每 tick 重试烧预算 */
const MAX_CONTINUATION_FAILURES = 3;

interface ContinuationContext {
  checkpoint?: ResumeCheckpoint;
  continuation?: {
    segmentCount?: number;
    cardMsgId?: string | null;
    cardTitle?: string;
    interimSent?: boolean;
    failures?: number;
  };
}

export async function sweepContinuations(): Promise<void> {
  const rows = (await db
    .select({
      id: agentTask.id,
      avatarId: agentTask.avatarId,
      ownerId: agentTask.ownerId,
      triggerMsgId: agentTask.triggerMsgId,
      triggerConvId: agentTask.triggerConvId,
      traceId: agentTask.traceId,
      context: agentTask.context,
      createdAt: agentTask.createdAt,
      updatedAt: agentTask.updatedAt,
    })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.status, 'waiting_continuation'),
        sql`${agentTask.updatedAt} < now() - ${config.continuationDelaySeconds} * interval '1 second'`,
        sql`(${agentTask.context} -> 'checkpoint') IS NOT NULL`,
      ),
    )
    .limit(config.continuationBatch)) as unknown as ContinuationRow[];

  for (const row of rows) {
    // fire-and-forget：不阻塞 tick；认领条件写保证不会重复驱动
    void continueTask(row).catch((e) =>
      log.error('continueTask crashed', { taskId: row.id, error: String(e) }),
    );
  }
}

async function continueTask(row: ContinuationRow): Promise<void> {
  const context = (row.context ?? {}) as ContinuationContext;
  // 失败退避：同一任务连续失败时指数退避，避免每 tick 重试烧预算
  const failures = context.continuation?.failures ?? 0;
  if (failures > 0) {
    const backoffMs = config.continuationDelaySeconds * 1000 * Math.min(2 ** failures, 12);
    if (Date.now() - dayjs(row.updatedAt).valueOf() < backoffMs) return;
  }
  const cp = context.checkpoint;
  if (!cp || !Array.isArray(cp.messages) || typeof cp.round !== 'number') {
    await failContinued(row.id, '缺少可续跑的检查点（checkpoint），无法继续');
    return;
  }
  if (!row.triggerMsgId || !row.triggerConvId) {
    await failContinued(row.id, '任务缺少触发消息引用，无法续跑');
    return;
  }

  // 整体护栏：时限 / 段数 / 日预算 —— 任一超限即转交主人收尾
  const budgetRows = await db
    .select({ dailyBudgetUsd: avatarTable.dailyBudgetUsd })
    .from(avatarTable)
    .where(eq(avatarTable.id, row.avatarId))
    .limit(1);
  const budget = Number(budgetRows[0]?.dailyBudgetUsd ?? config.avatarDailyBudgetUsd);
  const guard = evaluateContinuationGuard(
    {
      ageMs: Date.now() - dayjs(row.createdAt).valueOf(),
      segmentCount: context.continuation?.segmentCount ?? 0,
      costUsd: await todayCost(row.avatarId),
      budgetUsd: budget,
    },
    { maxAgeMs: config.longTaskMaxSeconds * 1000, maxSegments: config.longTaskMaxSegments },
  );
  if (!guard.ok) {
    await finishLongTask(row, context, guard.reason);
    return;
  }

  // 条件认领：waiting_continuation → running + 租约（0 行 = 已被取消/接管，让位）
  const moved = await db
    .update(agentTask)
    .set({
      status: 'running',
      lockedBy: RUNTIME_ID,
      leaseUntil: sql`now() + ${LEASE_TTL_S} * interval '1 second'`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(agentTask.id, row.id), eq(agentTask.status, 'waiting_continuation')))
    .returning({ id: agentTask.id });
  if (moved.length === 0) return;

  const trigger = await loadTriggerMessage(row.triggerMsgId);
  if (!trigger) {
    await failContinued(row.id, '触发消息已不存在，无法续跑');
    return;
  }
  const convRows = await db
    .select({ type: conversation.type })
    .from(conversation)
    .where(eq(conversation.id, row.triggerConvId))
    .limit(1);
  const convType = (convRows[0]?.type === 'group' ? 'group' : 'direct') as 'direct' | 'group';

  // 分身并发限制（与 pipeline / recovery 同款信号量）
  const semKey = aiKeys.semAvatar(row.avatarId);
  if (!(await redisSemaphoreAcquire(semKey, 2, 180))) {
    // 并发满：退回挂起态（刷新 updated_at 延迟退避），下个 tick 重试
    await revertToWaiting(row.id);
    return;
  }
  try {
    await withLease(row.id, async () => {
      await runAgent({
        avatarId: row.avatarId,
        ownerId: row.ownerId,
        taskId: row.id,
        convId: row.triggerConvId ?? '',
        convType,
        trigger,
        mode: cp.mode,
        strategy: cp.strategy,
        authorityVersion: cp.authorityVersion,
        via: cp.via,
        allowCapabilities: cp.allowCapabilities,
        maxRisk: cp.maxRisk,
        classification: classify(trigger.content.type === 'text' ? trigger.content.text : ''),
        traceId: row.traceId ?? row.id,
        resumeCheckpoint: cp,
      });
    });
  } catch (e) {
    if (e instanceof LeaseLostError) {
      // 租约被恢复进程夺走：新主人正在驱动（recovery 分支 B），本侧静默让位
      log.warn('lease lost during continuation', { taskId: row.id });
      return;
    }
    const safe = redactSecrets(String(e));
    log.error('continuation run failed', { taskId: row.id, error: safe });
    const nextFailures = failures + 1;
    if (nextFailures >= MAX_CONTINUATION_FAILURES) {
      // 连续失败：停止续跑并转交主人，不再无限重试
      await finishLongTask(
        row,
        context,
        `续跑连续失败 ${nextFailures} 次：${safe.slice(0, 120)}`,
        true,
      );
      return;
    }
    // 回到挂起态并记录失败次数；下次按指数退避重试
    await revertToWaiting(row.id, nextFailures);
  } finally {
    await redisSemaphoreRelease(semKey);
  }
}

/** 退回挂起态：仅当仍由本 runtime 持有 running 租约时生效，0 行 = 已被他人处理 */
async function revertToWaiting(taskId: string, failures = 0): Promise<void> {
  await db
    .update(agentTask)
    .set({
      status: 'waiting_continuation',
      context: sql`coalesce(${agentTask.context}, '{}'::jsonb) || ${JSON.stringify({
        continuation: { failures },
      })}::jsonb`,
      lockedBy: null,
      leaseUntil: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(agentTask.id, taskId),
        eq(agentTask.status, 'running'),
        eq(agentTask.lockedBy, RUNTIME_ID),
      ),
    )
    .catch(() => undefined);
}

/**
 * 停止长任务：护栏超限（waiting 态）或续跑连续失败（running 态）。
 * 条件写 0 行 = 已被取消/接管，不重复推卡。
 */
async function finishLongTask(
  row: ContinuationRow,
  context: ContinuationContext,
  reason: string,
  claimed = false,
): Promise<void> {
  const stopped = await db
    .update(agentTask)
    .set({
      status: 'handed_over',
      result: `长程任务停止续跑：${reason}`,
      decision: { action: 'handover', reason, confidence: 0 },
      lockedBy: null,
      leaseUntil: null,
      updatedAt: sql`now()`,
    })
    .where(
      claimed
        ? and(
            eq(agentTask.id, row.id),
            eq(agentTask.status, 'running'),
            eq(agentTask.lockedBy, RUNTIME_ID),
          )
        : and(eq(agentTask.id, row.id), eq(agentTask.status, 'waiting_continuation')),
    )
    .returning({ id: agentTask.id });
  if (stopped.length === 0) return; // 已被取消/认领，不重复推卡

  // 进度卡片收尾为 failed（表示未完成即停止），详情走转交卡片
  const cardMsgId = context.continuation?.cardMsgId;
  if (typeof cardMsgId === 'string' && cardMsgId) {
    await finishContinuationCard(row.id, 'failed', reason);
  }
  await internal
    .pushCard(row.ownerId, {
      kind: 'handover',
      taskId: row.id,
      summary: `长程任务已停止续跑（${reason}）。已执行的步骤可在任务详情回放查看；如需继续请重新发起。`,
      reason,
    })
    .catch(() => undefined);
  // 外部会话已发过「处理中」→ 补一句收尾，避免对方一直等不到结果
  await notifyPeerStopped(row, context, reason);
  await appendAudit(row.id, row.avatarId, 'continuation.finish', { reason }, { ok: false }, null);
  log.warn('long task stopped by guard', { taskId: row.id, reason });
}

/** 外部会话的停止通知：只在确实发过中间回复、且不是控制通道时发送；失败静默。 */
async function notifyPeerStopped(
  row: ContinuationRow,
  context: ContinuationContext,
  reason: string,
): Promise<void> {
  if (!context.continuation?.interimSent) return;
  if (!row.triggerMsgId || !row.triggerConvId) return;
  const avatarRows = await db
    .select({ selfConvId: avatarTable.selfConvId })
    .from(avatarTable)
    .where(eq(avatarTable.id, row.avatarId))
    .limit(1);
  if (avatarRows[0]?.selfConvId === row.triggerConvId) return;

  const cp = context.checkpoint;
  try {
    await internal.sendMessage(
      {
        clientMsgId: newId('ai'),
        convId: row.triggerConvId,
        senderId: row.avatarId,
        onBehalfOf: row.ownerId,
        content: {
          type: 'text',
          schemaVersion: 1,
          text: '这件事我暂时没法继续处理，已经交给主人本人跟进，稍后由 TA 回复你～',
        },
        mentions: [],
        replyTo: row.triggerMsgId,
        aiMeta: {
          taskId: row.id,
          mode: cp?.mode ?? 'auto',
          toolsUsed: cp?.toolsUsed ?? [],
          risk: 'L0',
          confidence: 0,
          hopCount: 1,
          authorityVersion: cp?.authorityVersion ?? 0,
          via: cp?.via ?? null,
          explanation: {
            decision: 'handover',
            reason,
            confidence: 0,
            toolsUsed: cp?.toolsUsed ?? [],
            memoriesUsed: [],
          },
        },
        authorityVersion: cp?.authorityVersion ?? 0,
        via: cp?.via ?? null,
      },
      row.id,
    );
  } catch (e) {
    log.warn('continuation stop notice failed', { taskId: row.id, error: String(e) });
  }
}

/**
 * 状态异常（缺检查点 / 缺触发引用）：条件置 failed，避免每个 tick 重复扫描。
 * 认领前后都可能调用：waiting_continuation（未认领）或 running + 本 runtime 租约（已认领）。
 */
async function failContinued(taskId: string, error: string): Promise<void> {
  await db
    .update(agentTask)
    .set({
      status: 'failed',
      error: redactSecrets(error).slice(0, 400),
      lockedBy: null,
      leaseUntil: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(agentTask.id, taskId),
        or(
          eq(agentTask.status, 'waiting_continuation'),
          and(eq(agentTask.status, 'running'), eq(agentTask.lockedBy, RUNTIME_ID)),
        ),
      ),
    )
    .catch(() => undefined);
  log.warn('continuation task failed', { taskId, error });
}
