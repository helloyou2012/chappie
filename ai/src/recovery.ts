/**
 * 孤儿任务恢复 —— 设计方案 §27.4 中断恢复 / §26.3 时效丢弃。
 *
 * 三机制协同（agent-runtime / task-lease 落地）：
 *   租约（lease_until 过期 = worker 崩溃）+ 轮次检查点（context.checkpoint）
 *   + 工具幂等账本（task_step.tool_call_id 三态判定：确定未执行 / 确定已执行 / 不确定）。
 *
 * sweepOrphanTasks 由 scheduler 每 tick 调用，原子认领（FOR UPDATE SKIP LOCKED +
 * 条件 UPDATE，多实例安全）。recoverTask 决策树（优先级从新到旧）：
 *   B 有检查点  → 补齐悬挂的工具结果后续跑（不重复已花 token 的模型轮次；
 *                非幂等工具不确定时保守转人工 —— 转账绝不自动重发）
 *   A 已决议审批 → 审批续跑中断：账本三态判定后走 runAfterApproval 公共尾段
 *   C 未起步    → 无任何副作用，driveTask 从头重驱（策略/护栏重新生效）
 */

import type { AvatarMode, Message } from '@chappie/contract';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  addStep,
  appendAudit,
  loadTriggerMessage,
  type ResumeCheckpoint,
  runAfterApproval,
  runAgent,
} from './agent-runtime';
import { createApproval, setApprovalResult, verifyApprovalArgs } from './approval';
import { classify } from './classifier';
import { config } from './common/config';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { log } from './common/log';
import { aiKeys, redisSemaphoreAcquire, redisSemaphoreRelease } from './common/redis';
import {
  heartbeatOnce,
  LEASE_TTL_S,
  LeaseLostError,
  RUNTIME_ID,
  withLease,
} from './common/task-lease';
import { agentTask, approval, conversation, taskStep } from './db/schema';
import type { ChatMessage, ToolCall } from './model-gateway';
import { driveTask, SemaphoreFullError } from './pipeline';
import { executeTool, getTool, prepareToolCall } from './tool-gateway';
import { redactSecrets } from './trust';
import { assertTurnAllowed, TurnRevokedError } from './turn-guard';

/** 认领到的孤儿任务行 */
type OrphanRow = {
  id: string;
  avatarId: string;
  ownerId: string;
  triggerMsgId: string | null;
  triggerConvId: string | null;
  triggerKind: string;
  status: string;
  context: Record<string, unknown> | null;
  traceId: string | null;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// 清扫与认领
// ---------------------------------------------------------------------------

export async function sweepOrphanTasks(): Promise<void> {
  const claimed = (await db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: agentTask.id })
      .from(agentTask)
      .where(
        sql`(
          (${agentTask.status} = 'created' AND (
               (${agentTask.leaseUntil} IS NULL
                 AND ${agentTask.updatedAt} < now() - ${config.recoveryCreatedGraceSeconds} * interval '1 second')
               OR (${agentTask.leaseUntil} IS NOT NULL AND ${agentTask.leaseUntil} < now())))
          OR (${agentTask.status} IN ('planning', 'running') AND (
               (${agentTask.leaseUntil} IS NULL
                 AND ${agentTask.updatedAt} < now() - ${config.recoveryCreatedGraceSeconds} * interval '1 second')
               OR (${agentTask.leaseUntil} IS NOT NULL AND ${agentTask.leaseUntil} < now())))
          OR (${agentTask.status} = 'waiting_approval' AND
               NOT EXISTS (SELECT 1 FROM approval a
                 WHERE a.task_id = ${agentTask.id} AND a.status = 'pending') AND
               EXISTS (SELECT 1 FROM approval a
                 WHERE a.task_id = ${agentTask.id} AND a.status IN ('approved', 'modified')
                   AND a.resolved_at < now() - ${config.recoveryApprovalGraceSeconds} * interval '1 second'))
        )`,
      )
      .limit(config.recoveryBatch)
      .for('update', { skipLocked: true });
    if (candidates.length === 0) return [] as OrphanRow[];
    return (await tx
      .update(agentTask)
      .set({
        lockedBy: RUNTIME_ID,
        leaseUntil: sql`now() + ${LEASE_TTL_S} * interval '1 second'`,
        updatedAt: sql`now()`,
      })
      .where(
        inArray(
          agentTask.id,
          candidates.map((c) => c.id),
        ),
      )
      .returning()) as unknown as OrphanRow[];
  })) as OrphanRow[];

  for (const row of claimed) {
    // fire-and-forget：不阻塞 tick；租约保证下个 tick 不会重复认领
    void recoverTask(row).catch((e) =>
      log.error('recoverTask crashed', { taskId: row.id, error: String(e) }),
    );
  }
  if (claimed.length > 0) {
    log.info('orphan tasks claimed', { count: claimed.length, ids: claimed.map((c) => c.id) });
  }
}

// ---------------------------------------------------------------------------
// 恢复决策树
// ---------------------------------------------------------------------------

async function recoverTask(task: OrphanRow): Promise<void> {
  // 时效线（设计方案 §26.3）：过老的自动回复已无意义，丢弃并通知
  const ageMs = Date.now() - dayjs(task.createdAt).valueOf();
  if (ageMs > config.recoveryStaleSeconds * 1000) {
    await db
      .update(agentTask)
      .set({
        status: 'failed',
        error: 'worker 中断后任务积压过期，已丢弃（设计方案 §26.3）',
        lockedBy: null,
        leaseUntil: null,
        updatedAt: sql`now()`,
      })
      .where(eq(agentTask.id, task.id));
    await internal
      .pushCard(task.ownerId, {
        kind: 'handover',
        taskId: task.id,
        summary: '有一条消息在服务中断后已过期，分身不再代回；如仍需要请重新发送。',
        reason: '恢复时效过期',
      })
      .catch(() => undefined);
    await appendAudit(
      task.id,
      task.avatarId,
      'recovery.discard',
      { status: task.status, ageMs },
      { ok: false },
      null,
    );
    log.warn('orphan task discarded (stale)', { taskId: task.id, ageMs });
    return;
  }

  if (!task.triggerMsgId || !task.triggerConvId) {
    await failRecovered(task, '任务缺少触发消息引用，无法恢复');
    return;
  }
  const trigger = await loadTriggerMessage(task.triggerMsgId);
  if (!trigger) {
    await failRecovered(task, '触发消息已不存在，无法恢复');
    return;
  }

  try {
    await withLease(task.id, () => recoverTaskInner(task, trigger));
  } catch (e) {
    if (e instanceof LeaseLostError) {
      // 我们自己的租约又被夺走（极端套娃）：静默让位
      log.warn('lease lost during recovery', { taskId: task.id });
      return;
    }
    if (e instanceof SemaphoreFullError) {
      // 分身并发满：短租约让出，下个 tick 重试
      await deferClaim(task.id);
      return;
    }
    log.error('recoverTask failed', { taskId: task.id, error: String(e) });
    await failRecovered(task, String(e).slice(0, 400));
  }
}

async function recoverTaskInner(task: OrphanRow, trigger: Message) {
  await addStep(
    task.id,
    200,
    'recover',
    { claimedBy: RUNTIME_ID, from: task.status },
    { ok: true },
  );
  await appendAudit(
    task.id,
    task.avatarId,
    'recovery.claim',
    { from: task.status },
    { claimedBy: RUNTIME_ID },
    null,
  );

  const checkpoint = extractCheckpoint(task);

  // 分支 B：有检查点 → 补齐悬挂工具结果后续跑（最新状态优先）
  if (checkpoint) {
    return recoverFromCheckpoint(task, trigger, checkpoint);
  }

  // 分支 A：已决议审批的续跑中断 → 账本三态判定后走公共尾段
  const resolved = await findResolvedApproval(task.id);
  if (resolved) {
    return recoverResolvedApproval(task, resolved);
  }

  // 分支 C：未起步（无检查点、无审批）→ 从头重驱，策略/护栏重新生效
  return recoverFromScratch(task, trigger);
}

// ---------------------------------------------------------------------------
// 分支 B：检查点续跑
// ---------------------------------------------------------------------------

function extractCheckpoint(task: OrphanRow): ResumeCheckpoint | null {
  const cp = task.context?.checkpoint;
  if (!cp || typeof cp !== 'object') return null;
  const c = cp as ResumeCheckpoint;
  if (!Array.isArray(c.messages) || typeof c.round !== 'number') return null;
  return c;
}

/** 消息尾部悬挂的 assistant toolCalls 中，尚未有 role=tool 应答的调用 */
function danglingToolCalls(messages: ChatMessage[]): ToolCall[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const answered = new Set(
        messages
          .filter((x) => x.role === 'tool' && x.toolCallId)
          .map((x) => x.toolCallId as string),
      );
      return m.toolCalls.filter((c) => !answered.has(c.id));
    }
    if (m.role === 'tool') continue; // 跳过尾部已应答的工具结果
    break; // user / 无 toolCalls 的 assistant：没有悬挂
  }
  return [];
}

async function recoverFromCheckpoint(
  task: OrphanRow,
  trigger: Message,
  cp: ResumeCheckpoint,
): Promise<void> {
  const messages = [...cp.messages];
  const dangling = danglingToolCalls(messages);
  const toolsUsed = [...cp.toolsUsed];

  for (const call of dangling) {
    // 回合级撤权：恢复路径同样必须在每次工具执行前确认
    try {
      await assertTurnAllowed({
        taskId: task.id,
        avatarId: task.avatarId,
        ownerId: task.ownerId,
        convId: task.triggerConvId ?? '',
        expectedMode: cp.mode,
        phase: 'run',
      });
    } catch (e) {
      if (e instanceof TurnRevokedError) {
        await handoverRevoked(task, e.reason);
        return;
      }
      throw e;
    }

    const tool = getTool(call.name);
    if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);

    // 确定已执行：账本有完成记录 → 复用输出（不重复执行）
    const completed = await findCompletedOutput(task.id, call.id);
    if (completed !== undefined) {
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(completed) });
      await appendAudit(
        task.id,
        task.avatarId,
        'tool.execute.reused',
        { tool: call.name },
        { reused: true },
        null,
      );
      continue;
    }

    // 不确定：非幂等工具已有意图标记但无完成记录 → 保守转人工（转账绝不自动重发）
    if (tool && !tool.idempotent && (await hasPendingMarker(task.id, call.id))) {
      await handoverUncertain(
        task,
        `分身在执行「${tool.name}」时服务中断，无法确认该操作是否已生效，为避免重复执行已转交你处理。`,
      );
      return;
    }

    // 确定未执行（或幂等工具重跑）：走 prepareToolCall 审批护栏
    if (!tool) {
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({ error: '未知工具' }),
      });
      continue;
    }
    const stepIdx = 210 + messages.length;
    const decision = await prepareToolCall({
      avatarId: task.avatarId,
      toolId: call.name,
      rawArgs: call.args,
      policyAllowCapabilities: cp.allowCapabilities,
      maxRisk: cp.maxRisk,
    });
    await addStep(
      task.id,
      stepIdx,
      'guard',
      { tool: call.name, args: call.args, recovered: true },
      { decision: decision.status, reason: 'reason' in decision ? decision.reason : undefined },
    );
    if (decision.status === 'denied') {
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({ error: decision.reason }),
      });
      continue;
    }
    if (decision.status === 'need_approval') {
      const apr = await createApproval({
        taskId: task.id,
        avatarId: task.avatarId,
        ownerId: task.ownerId,
        tool: decision.tool,
        args: decision.args,
      });
      await db
        .update(agentTask)
        .set({
          status: 'waiting_approval',
          context: sql`coalesce(${agentTask.context}, '{}'::jsonb) || ${JSON.stringify({
            mode: cp.mode,
            allowCapabilities: cp.allowCapabilities,
            maxRisk: cp.maxRisk,
            convId: task.triggerConvId,
            confidence: 0.75,
            checkpoint: null,
          })}::jsonb`,
          lockedBy: null,
          leaseUntil: null,
          updatedAt: sql`now()`,
        })
        .where(eq(agentTask.id, task.id));
      log.info('recovered tool needs approval again', {
        taskId: task.id,
        approvalId: apr.approvalId,
      });
      return;
    }

    // 执行（非幂等带意图标记 + 围栏，与主循环一致）
    if (!decision.tool.idempotent) {
      await addStep(
        task.id,
        stepIdx + 1,
        'tool_pending',
        { tool: call.name, args: decision.args },
        { ok: true },
        { critical: true, toolCallId: call.id },
      );
      if (!(await heartbeatOnce(task.id))) throw new LeaseLostError(task.id);
    }
    let output: unknown;
    try {
      output = await executeTool(decision.tool, decision.args, {
        avatarId: task.avatarId,
        ownerId: task.ownerId,
        taskId: task.id,
        traceId: task.traceId ?? task.id,
      });
    } catch (e) {
      output = { error: String(e) };
    }
    await addStep(
      task.id,
      stepIdx + 2,
      'tool',
      { tool: call.name, args: decision.args, recovered: true },
      output,
      { critical: true, toolCallId: call.id },
    );
    await appendAudit(
      task.id,
      task.avatarId,
      'tool.execute.recovered',
      { tool: call.name, args: decision.args },
      output,
      decision.tool.risk,
    );
    messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(output) });
  }

  const semKey = aiKeys.semAvatar(task.avatarId);
  if (!(await redisSemaphoreAcquire(semKey, 2, 180))) throw new SemaphoreFullError(task.id);
  try {
    const convRows = await db
      .select({ type: conversation.type })
      .from(conversation)
      .where(eq(conversation.id, task.triggerConvId ?? ''))
      .limit(1);
    const convType = (convRows[0]?.type === 'group' ? 'group' : 'direct') as 'direct' | 'group';

    await runAgent({
      avatarId: task.avatarId,
      ownerId: task.ownerId,
      taskId: task.id,
      convId: task.triggerConvId ?? '',
      trigger,
      convType,
      mode: cp.mode,
      allowCapabilities: cp.allowCapabilities,
      maxRisk: cp.maxRisk,
      classification: classify(trigger.content.type === 'text' ? trigger.content.text : ''),
      traceId: task.traceId ?? task.id,
      // 悬挂工具结果已补齐 → 从下一轮模型调用继续，不重复已完成的轮次
      resumeCheckpoint: {
        ...cp,
        messages,
        round: cp.round + 1,
        stepIdx: cp.stepIdx + dangling.length * 3,
        toolsUsed,
      },
    });
  } finally {
    await redisSemaphoreRelease(semKey);
  }
}

// ---------------------------------------------------------------------------
// 分支 A：审批续跑中断
// ---------------------------------------------------------------------------

async function findResolvedApproval(taskId: string) {
  const rows = await db
    .select()
    .from(approval)
    .where(and(eq(approval.taskId, taskId), inArray(approval.status, ['approved', 'modified'])))
    .orderBy(desc(approval.resolvedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function recoverResolvedApproval(
  task: OrphanRow,
  apr: typeof approval.$inferSelect,
): Promise<void> {
  // waiting_approval → running（心跳只对 planning/running 续约，也是续跑状态机要求）
  // 0 行 = 已被 takeover/取消/其他恢复进程处理，直接让位
  const moved = await db
    .update(agentTask)
    .set({ status: 'running', updatedAt: sql`now()` })
    .where(and(eq(agentTask.id, task.id), eq(agentTask.status, 'waiting_approval')))
    .returning({ id: agentTask.id });
  if (moved.length === 0) return;

  const callId = `apr_${apr.id}`;
  let args = apr.modifiedArgs ?? apr.args;
  const tool = getTool(apr.toolName);

  // 确定已执行：账本完成记录，或审批行已回填结果（setApprovalResult 之后崩溃）
  const ledgerDone = await findCompletedOutput(task.id, callId);
  const completed = ledgerDone !== undefined ? ledgerDone : (apr.result ?? undefined);
  let result: unknown;

  if (completed !== undefined) {
    result = completed;
    await appendAudit(
      task.id,
      task.avatarId,
      'tool.execute.reused',
      { tool: apr.toolName },
      { reused: true },
      null,
    );
  } else if (await hasPendingMarker(task.id, callId)) {
    // 不确定：意图标记存在但无完成记录 → 保守转人工
    await handoverUncertain(
      task,
      `分身在执行已批准的「${apr.title}」时服务中断，无法确认操作是否已生效，为避免重复执行已转交你处理。`,
    );
    return;
  } else {
    // 确定未执行 → 补跑（带账本标记 + 围栏）
    if (!tool) {
      await handoverUncertain(task, `已批准的操作引用了未知工具「${apr.toolName}」，无法恢复。`);
      return;
    }

    // 参数规范化 + 审批指纹校验：执行、审计、回调使用同一份 safeArgs
    const parsed = tool.validate.safeParse(args);
    if (!parsed.success) {
      await handoverUncertain(
        task,
        `已批准的操作参数不合法（${parsed.error.message.slice(0, 160)}），已转交你处理。`,
      );
      return;
    }
    const safeArgs = parsed.data as Record<string, unknown>;
    const verified = verifyApprovalArgs(apr, safeArgs);
    if (!verified.ok) {
      await appendAudit(
        task.id,
        task.avatarId,
        'approval.hash_mismatch',
        { approvalId: apr.id, tool: apr.toolName },
        { expected: verified.expected, actual: verified.actual },
        null,
      );
      await handoverUncertain(task, '审批参数指纹不一致，为安全起见已转交你处理。');
      return;
    }
    if (verified.legacy) {
      await appendAudit(
        task.id,
        task.avatarId,
        'approval.hash_legacy',
        { approvalId: apr.id, tool: apr.toolName },
        { ok: true },
        null,
      );
    }

    // 回合级撤权
    try {
      await assertTurnAllowed({
        taskId: task.id,
        avatarId: task.avatarId,
        ownerId: task.ownerId,
        convId: task.triggerConvId ?? '',
        expectedMode: ((task.context?.mode as string | undefined) ?? 'manual') as AvatarMode,
        phase: 'run',
      });
    } catch (e) {
      if (e instanceof TurnRevokedError) {
        await handoverRevoked(task, e.reason);
        return;
      }
      throw e;
    }
    args = safeArgs;

    await addStep(
      task.id,
      230,
      'tool_pending',
      { tool: tool.id, args, approved: true, recovered: true },
      { ok: true },
      { critical: true, toolCallId: callId },
    );
    if (!(await heartbeatOnce(task.id))) throw new LeaseLostError(task.id);
    try {
      result = await executeTool(tool, args, {
        avatarId: task.avatarId,
        ownerId: task.ownerId,
        taskId: task.id,
        traceId: task.traceId ?? task.id,
      });
    } catch (e) {
      result = { error: redactSecrets(String(e)) };
    }
    await setApprovalResult(apr.id, result);
    await addStep(
      task.id,
      231,
      'tool',
      { tool: tool.id, args, approved: true, recovered: true },
      result,
      { critical: true, toolCallId: callId },
    );
    await appendAudit(
      task.id,
      task.avatarId,
      'tool.execute.recovered',
      { tool: tool.id, args },
      result,
      tool.risk,
    );
  }

  const semKey = aiKeys.semAvatar(task.avatarId);
  if (!(await redisSemaphoreAcquire(semKey, 2, 180))) throw new SemaphoreFullError(task.id);
  try {
    await runAfterApproval({
      taskId: task.id,
      avatarId: task.avatarId,
      ownerId: task.ownerId,
      approvalId: apr.id,
      toolName: apr.toolName,
      args,
      result,
    });
  } finally {
    await redisSemaphoreRelease(semKey);
  }
}

// ---------------------------------------------------------------------------
// 分支 C：未起步重驱
// ---------------------------------------------------------------------------

async function recoverFromScratch(task: OrphanRow, trigger: Message): Promise<void> {
  // planning/running 但无检查点 = 尚未产生任何模型/工具副作用；
  // 重置 created 让 driveTask 的条件迁移生效（策略/意图/护栏全部重新求值）
  await db
    .update(agentTask)
    .set({ status: 'created', updatedAt: sql`now()` })
    .where(and(eq(agentTask.id, task.id), eq(agentTask.lockedBy, RUNTIME_ID)));

  await driveTask(
    {
      taskId: task.id,
      avatarId: task.avatarId,
      ownerId: task.ownerId,
      triggerMsgId: task.triggerMsgId ?? '',
      triggerConvId: task.triggerConvId ?? '',
      triggerKind: task.triggerKind,
      traceId: task.traceId ?? task.id,
    },
    trigger,
    { recovery: true },
  );
}

// ---------------------------------------------------------------------------
// 账本查询 / 公共小件
// ---------------------------------------------------------------------------

/** 幂等账本：工具调用完成记录（task_step type='tool'） */
async function findCompletedOutput(
  taskId: string,
  toolCallId: string,
): Promise<unknown | undefined> {
  const rows = await db
    .select({ output: taskStep.output })
    .from(taskStep)
    .where(
      and(
        eq(taskStep.taskId, taskId),
        eq(taskStep.toolCallId, toolCallId),
        eq(taskStep.type, 'tool'),
      ),
    )
    .limit(1);
  return rows[0]?.output;
}

/** 幂等账本：非幂等工具的执行前意图标记（task_step type='tool_pending'） */
async function hasPendingMarker(taskId: string, toolCallId: string): Promise<boolean> {
  const rows = await db
    .select({ id: taskStep.id })
    .from(taskStep)
    .where(
      and(
        eq(taskStep.taskId, taskId),
        eq(taskStep.toolCallId, toolCallId),
        eq(taskStep.type, 'tool_pending'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** 不确定 → 保守转人工：handover 卡片 + handed_over（宁过度谨慎，不静默重复执行） */
async function handoverUncertain(task: OrphanRow, summary: string): Promise<void> {
  const safe = redactSecrets(summary);
  const rows = await db
    .update(agentTask)
    .set({
      status: 'handed_over',
      result: safe,
      decision: { action: 'handover', reason: '恢复时无法确认工具执行结果', confidence: 0 },
      lockedBy: null,
      leaseUntil: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(agentTask.id, task.id), inArray(agentTask.status, ['planning', 'running'])))
    .returning({ id: agentTask.id });
  if (rows.length === 0) return; // 已被 takeover/其他进程处理，不重复推卡

  await internal
    .pushCard(task.ownerId, {
      kind: 'handover',
      taskId: task.id,
      summary: safe,
      reason: '恢复时无法确认工具执行结果',
    })
    .catch(() => undefined);
  await appendAudit(
    task.id,
    task.avatarId,
    'recovery.unknown',
    { summary: safe },
    { ok: false },
    null,
  );
  log.warn('orphan task handed over (uncertain tool effect)', { taskId: task.id });
}

/** 恢复时发现回合已撤销：条件写 handed_over，0 行则静默让位。 */
async function handoverRevoked(task: OrphanRow, reason: string): Promise<void> {
  const safe = redactSecrets(reason);
  const rows = await db
    .update(agentTask)
    .set({
      status: 'handed_over',
      result: `回合已撤销：${safe}`,
      decision: { action: 'revoked', reason: safe, confidence: 0 },
      lockedBy: null,
      leaseUntil: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(agentTask.id, task.id), inArray(agentTask.status, ['planning', 'running'])))
    .returning({ id: agentTask.id });
  if (rows.length === 0) return;

  await internal
    .pushCard(task.ownerId, {
      kind: 'handover',
      taskId: task.id,
      summary: `分身恢复时发现该回合已被暂停：${safe}。已完成的操作请复核。`,
      reason: '回合撤销',
    })
    .catch(() => undefined);
  await appendAudit(task.id, task.avatarId, 'turn.revoked', { reason: safe }, { ok: false }, null);
  log.warn('orphan task revoked during recovery', { taskId: task.id, reason: safe });
}

async function failRecovered(task: OrphanRow, error: string): Promise<void> {
  const safe = redactSecrets(error);
  await db
    .update(agentTask)
    .set({ status: 'failed', error: safe, lockedBy: null, leaseUntil: null, updatedAt: sql`now()` })
    .where(eq(agentTask.id, task.id))
    .catch(() => undefined);
  log.warn('orphan task failed during recovery', { taskId: task.id, error: safe });
}

/** 分身并发满：短租约让出，下个 tick 重新认领 */
async function deferClaim(taskId: string): Promise<void> {
  await db
    .update(agentTask)
    .set({ leaseUntil: sql`now() + 45 * interval '1 second'`, updatedAt: sql`now()` })
    .where(eq(agentTask.id, taskId))
    .catch(() => undefined);
}
