/**
 * 审计写入：脱敏 + 截断 + canonical JSON 哈希链。
 *
 * 原则：
 *   - params/result 写入前递归脱敏并截断，避免把完整邮件正文、凭据等落盘；
 *   - 哈希使用 canonical JSON，保证跨进程/跨语言可复算；
 *   - 写入失败只记 error 日志，不阻塞主流程，但不再静默。
 */

import { desc } from 'drizzle-orm';
import { auditLog } from '../db/schema';
import { redactSecrets } from '../trust';
import { canonicalJson, sha256Hex } from './canonical';
import { db } from './db';
import { log } from './log';

const MAX_DEPTH = 6;
const MAX_ITEMS = 50;
const MAX_STRING = 1000;

/** 递归脱敏并限制体积：保留结构，便于人工排查；不用于需要复算的审批参数。 */
export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const redacted = redactSecrets(value);
    return redacted.length > MAX_STRING ? `${redacted.slice(0, MAX_STRING)}…` : redacted;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => sanitizeAuditValue(item, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`…共 ${value.length} 项`);
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS);
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    out[key] = sanitizeAuditValue(item, depth + 1);
  }
  if (Object.keys(value as Record<string, unknown>).length > MAX_ITEMS) {
    out.__truncated = true;
  }
  return out;
}

export async function appendAudit(
  taskId: string,
  actor: string,
  action: string,
  params: unknown,
  result: unknown,
  risk: string | null,
): Promise<void> {
  const safeParams = sanitizeAuditValue(params);
  const safeResult = sanitizeAuditValue(result);
  try {
    const prevRows = await db
      .select({ hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(1);
    const prevHash = prevRows[0]?.hash ?? '';
    const row = { taskId, actor, action, params: safeParams, result: safeResult, risk };
    const hash = sha256Hex(prevHash + canonicalJson(row));
    await db.insert(auditLog).values({
      taskId,
      actor,
      action,
      params: safeParams,
      result: safeResult,
      risk,
      prevHash,
      hash,
    });
  } catch (e) {
    log.error('audit write failed', { taskId, action, error: String(e) });
  }
}
