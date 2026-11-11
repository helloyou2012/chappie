/**
 * L2 审批 —— 设计方案 §27.7 / §29.4：
 * 创建审批 + 推送确认卡片；超时默认拒绝；决议写审计。
 */

import type { ApprovalCard } from '@chappie/contract';
import { and, eq, lt, sql } from 'drizzle-orm';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { log, newId } from './common/log';
import { agentTask, approval } from './db/schema';
import type { BuiltinTool } from './tool-gateway';

export interface ApprovalRecord {
  id: string;
  taskId: string;
  avatarId: string;
  approver: string;
  title: string;
  toolName: string;
  args: Record<string, unknown>;
  status: string;
  modifiedArgs: Record<string, unknown> | null;
  cardMsgId: string | null;
  result: unknown;
  expiresAt: Date;
  resolvedAt: Date | null;
}

export async function createApproval(params: {
  taskId: string;
  avatarId: string;
  ownerId: string;
  tool: BuiltinTool;
  args: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<{ approvalId: string; cardMsgId: string; expiresAt: Date }> {
  const approvalId = newId('ap');
  const ttl = params.ttlSeconds ?? 3600;
  const expiresAt = dayjs().add(ttl, 'second');
  const title = `请求执行：${params.tool.name}`;
  const summary =
    `分身准备执行「${params.tool.name}」（${params.tool.risk}）。` +
    `参数：${JSON.stringify(params.args).slice(0, 180)}。` +
    (params.tool.risk === 'L2' ? '该操作属于高风险，需要你确认后才会执行。' : '');

  await db.insert(approval).values({
    id: approvalId,
    taskId: params.taskId,
    avatarId: params.avatarId,
    approver: params.ownerId,
    title,
    toolName: params.tool.id,
    args: params.args,
    status: 'pending',
    expiresAt: expiresAt.toDate(),
  });

  const card: ApprovalCard = {
    kind: 'approval',
    approvalId,
    taskId: params.taskId,
    title,
    summary,
    toolName: params.tool.id,
    args: params.args,
    risk: params.tool.risk,
    expiresAt: expiresAt.toISOString(),
  };
  const { msgId } = await internal.pushCard(params.ownerId, card);
  await db.update(approval).set({ cardMsgId: msgId }).where(eq(approval.id, approvalId));
  log.info('approval created', {
    approvalId,
    taskId: params.taskId,
    tool: params.tool.id,
    cardMsgId: msgId,
  });
  return { approvalId, cardMsgId: msgId, expiresAt: expiresAt.toDate() };
}

export async function getApproval(approvalId: string): Promise<ApprovalRecord | null> {
  const rows = await db.select().from(approval).where(eq(approval.id, approvalId)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    taskId: r.taskId,
    avatarId: r.avatarId,
    approver: r.approver,
    title: r.title,
    toolName: r.toolName,
    args: r.args,
    status: r.status,
    modifiedArgs: r.modifiedArgs,
    cardMsgId: r.cardMsgId,
    result: r.result,
    expiresAt: r.expiresAt,
    resolvedAt: r.resolvedAt,
  };
}

/** 决议写入（approved / modified / rejected），返回更新后的记录 */
export async function resolveApproval(
  approvalId: string,
  status: 'approved' | 'modified' | 'rejected',
  modifiedArgs?: Record<string, unknown> | null,
): Promise<ApprovalRecord | null> {
  await db
    .update(approval)
    .set({
      status,
      modifiedArgs: modifiedArgs ?? null,
      resolvedAt: sql`now()`,
    })
    .where(and(eq(approval.id, approvalId), eq(approval.status, 'pending')));
  return getApproval(approvalId);
}

/** 回填工具执行结果（批准后由恢复流程写入） */
export async function setApprovalResult(approvalId: string, result: unknown): Promise<void> {
  await db.update(approval).set({ result }).where(eq(approval.id, approvalId));
}

/** 超时清理：默认拒绝并通知（设计方案 §27.7） */
export async function sweepExpiredApprovals(): Promise<number> {
  const rows = await db
    .update(approval)
    .set({ status: 'expired', resolvedAt: sql`now()` })
    .where(and(eq(approval.status, 'pending'), lt(approval.expiresAt, sql`now()`)))
    .returning({
      id: approval.id,
      taskId: approval.taskId,
      approver: approval.approver,
      title: approval.title,
    });
  for (const r of rows) {
    await db
      .update(agentTask)
      .set({ status: 'cancelled', error: '审批超时，已默认拒绝', updatedAt: sql`now()` })
      .where(and(eq(agentTask.id, r.taskId), eq(agentTask.status, 'waiting_approval')));
    await internal
      .pushCard(r.approver, {
        kind: 'handover',
        taskId: r.taskId,
        summary: `「${r.title}」的确认请求已超时，已按默认拒绝处理。`,
        reason: '审批超时',
      })
      .catch(() => undefined);
  }
  if (rows.length > 0) log.info('expired approvals swept', { count: rows.length });
  return rows.length;
}
