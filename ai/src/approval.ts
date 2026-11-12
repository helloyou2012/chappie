/**
 * L2 审批 —— 设计方案 §27.7 / §29.4：
 * 创建审批 + 推送确认卡片；超时默认拒绝；决议写审计。
 *
 * 设计要点：审批即数据、参数指纹、一次性执行：
 *   - 审批行绑定 canonical args 指纹（argsHash），执行前必须校验；
 *   - 修改后批准必须重新规范化参数并重算指纹；
 *   - 旧行 argsHash = NULL 视为 legacy，允许执行但写审计告警。
 */

import type { ApprovalCard } from '@chappie/contract';
import { and, eq, lt, sql } from 'drizzle-orm';
import { fingerprint } from './common/canonical';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { parseJsonSafe } from './common/json';
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
  argsHash: string | null;
  status: string;
  modifiedArgs: Record<string, unknown> | null;
  cardMsgId: string | null;
  result: unknown;
  expiresAt: Date;
  resolvedAt: Date | null;
}

export interface ResolveResult {
  record: ApprovalRecord | null;
  /** 条件更新是否真的把 pending 迁移到终态；false = 竞争/已处理 */
  transitioned: boolean;
}

/** JSONB 可能以字符串返回；统一成 plain object。 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return parseJsonSafe<Record<string, unknown>>(value) ?? {};
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * 审批参数指纹（域分离）：
 * 同一份参数换工具/任务/审批人不能复用指纹。
 */
export function approvalArgsHash(input: {
  approvalId: string;
  taskId: string;
  avatarId: string;
  approver: string;
  tool: string;
  args: Record<string, unknown>;
}): string {
  return fingerprint('approval:v1', {
    approvalId: input.approvalId,
    taskId: input.taskId,
    avatarId: input.avatarId,
    approver: input.approver,
    tool: input.tool,
    args: input.args,
  });
}

export type ApprovalVerifyResult =
  | { ok: true; legacy: boolean }
  | { ok: false; expected: string; actual: string };

/** 校验「即将执行的参数」是否与审批落库的参数一致。legacy NULL 放行。 */
export function verifyApprovalArgs(
  record: Pick<ApprovalRecord, 'id' | 'taskId' | 'avatarId' | 'approver' | 'toolName' | 'argsHash'>,
  effectiveArgs: Record<string, unknown>,
): ApprovalVerifyResult {
  if (!record.argsHash) return { ok: true, legacy: true };
  const actual = approvalArgsHash({
    approvalId: record.id,
    taskId: record.taskId,
    avatarId: record.avatarId,
    approver: record.approver,
    tool: record.toolName,
    args: effectiveArgs,
  });
  if (actual === record.argsHash) return { ok: true, legacy: false };
  return { ok: false, expected: record.argsHash, actual };
}

export async function createApproval(params: {
  taskId: string;
  avatarId: string;
  ownerId: string;
  tool: BuiltinTool;
  args: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<{ approvalId: string; cardMsgId: string; expiresAt: Date; argsHash: string }> {
  const approvalId = newId('ap');
  const ttl = params.ttlSeconds ?? 3600;
  const expiresAt = dayjs().add(ttl, 'second');
  const title = `请求执行：${params.tool.name}`;
  const argsHash = approvalArgsHash({
    approvalId,
    taskId: params.taskId,
    avatarId: params.avatarId,
    approver: params.ownerId,
    tool: params.tool.id,
    args: params.args,
  });
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
    argsHash,
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
  return { approvalId, cardMsgId: msgId, expiresAt: expiresAt.toDate(), argsHash };
}

function mapRecord(r: typeof approval.$inferSelect): ApprovalRecord {
  return {
    id: r.id,
    taskId: r.taskId,
    avatarId: r.avatarId,
    approver: r.approver,
    title: r.title,
    toolName: r.toolName,
    args: asRecord(r.args),
    argsHash: r.argsHash ?? null,
    status: r.status,
    modifiedArgs: r.modifiedArgs ? asRecord(r.modifiedArgs) : null,
    cardMsgId: r.cardMsgId,
    result: r.result,
    expiresAt: r.expiresAt,
    resolvedAt: r.resolvedAt,
  };
}

export async function getApproval(approvalId: string): Promise<ApprovalRecord | null> {
  const rows = await db.select().from(approval).where(eq(approval.id, approvalId)).limit(1);
  return rows[0] ? mapRecord(rows[0]) : null;
}

/**
 * 决议写入（approved / modified / rejected）。
 * 只有真正从 pending 迁移的行才算 transitioned；竞争/重复决议返回 false。
 * 普通 approve 不写 modifiedArgs（只有 modify_approve 才写）。
 */
export async function resolveApproval(
  approvalId: string,
  status: 'approved' | 'modified' | 'rejected',
  modifiedArgs?: Record<string, unknown> | null,
  argsHash?: string,
): Promise<ResolveResult> {
  const rows = await db
    .update(approval)
    .set({
      status,
      modifiedArgs: status === 'modified' ? (modifiedArgs ?? null) : null,
      // 修改后批准：参数指纹与状态在同一条 UPDATE 里落库，避免中间态
      ...(argsHash ? { argsHash } : {}),
      resolvedAt: sql`now()`,
    })
    .where(and(eq(approval.id, approvalId), eq(approval.status, 'pending')))
    .returning();
  if (rows.length === 0) {
    return { record: await getApproval(approvalId), transitioned: false };
  }
  return { record: mapRecord(rows[0]), transitioned: true };
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
