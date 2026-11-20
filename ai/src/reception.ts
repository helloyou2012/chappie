/**
 * 接待摘要与对端请求真人卡片。
 *
 * 设计原则：摘要优先用确定性 SQL 聚合，立即出卡；可选 LLM 总结不阻塞交接。
 */

import type { CardPayload } from '@chappie/contract';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from './common/db';
import { internal } from './common/internal';
import { log } from './common/log';
import { agentTask, approval as approvalTable, message as messageTable, user } from './db/schema';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function buildReceptionDigest(
  ownerId: string,
  convId: string,
  reason = '接管',
): Promise<CardPayload> {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_MS);

  const [received, replied, drafts, silent, escalated, pending] = await Promise.all([
    dbCountMessages(convId, ownerId, from),
    dbCountTasks(ownerId, convId, from, ['completed'], 'reply'),
    dbCountTasks(ownerId, convId, from, ['completed'], 'draft'),
    dbCountTasks(ownerId, convId, from, ['skipped'], null),
    dbCountTasks(ownerId, convId, from, ['handed_over'], null),
    dbPending(ownerId, convId),
  ]);

  const recent = await db
    .select({
      senderId: messageTable.senderId,
      content: messageTable.content,
      createdAt: messageTable.createdAt,
    })
    .from(messageTable)
    .where(and(eq(messageTable.convId, convId), gte(messageTable.createdAt, from)))
    .orderBy(desc(messageTable.seq))
    .limit(8);

  const threads = recent.slice(0, 5).map((m) => ({
    convId,
    peerName: m.senderId === ownerId ? '我' : '对方',
    lastText: typeof m.content.text === 'string' ? m.content.text.slice(0, 120) : '[非文本消息]',
    status: 'handled',
  }));

  const summary =
    `分身在你离开期间收到 ${received} 条消息，回复 ${replied} 条，` +
    `生成草稿 ${drafts} 条，静默记录 ${silent} 条，转交 ${escalated} 条。` +
    (pending.length > 0 ? `\n有 ${pending.length} 项待你确认。` : '') +
    `\n触发原因：${reason}`;

  return {
    kind: 'reception_digest',
    convId,
    from: from.toISOString(),
    to: to.toISOString(),
    stats: { received, replied, drafts, silent, escalated },
    threads,
    pending,
    summary,
  };
}

async function dbCountMessages(convId: string, ownerId: string, from: Date): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageTable)
    .where(
      and(
        eq(messageTable.convId, convId),
        gte(messageTable.createdAt, from),
        sql`${messageTable.senderId} <> ${ownerId}`,
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

async function dbCountTasks(
  ownerId: string,
  convId: string,
  from: Date,
  statuses: string[],
  action: string | null,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.ownerId, ownerId),
        eq(agentTask.triggerConvId, convId),
        gte(agentTask.createdAt, from),
        inArray(agentTask.status, statuses),
        action ? sql`${agentTask.decision}->>'action' = ${action}` : sql`true`,
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

async function dbPending(
  ownerId: string,
  convId: string,
): Promise<{ kind: string; id: string; title: string }[]> {
  const approvals = await db
    .select({ id: approvalTable.id, title: approvalTable.title })
    .from(approvalTable)
    .where(and(eq(approvalTable.approver, ownerId), eq(approvalTable.status, 'pending')))
    .limit(5);
  const drafts = await db
    .select({ id: agentTask.id, result: agentTask.result })
    .from(agentTask)
    .where(
      and(
        eq(agentTask.ownerId, ownerId),
        eq(agentTask.triggerConvId, convId),
        eq(agentTask.status, 'completed'),
        sql`${agentTask.decision}->>'action' = 'draft'`,
      ),
    )
    .orderBy(desc(agentTask.createdAt))
    .limit(5);
  return [
    ...approvals.map((a) => ({ kind: 'approval', id: a.id, title: a.title })),
    ...drafts.map((d) => ({
      kind: 'draft',
      id: d.id,
      title: (d.result ?? '待确认草稿').slice(0, 60),
    })),
  ];
}

export async function pushReceptionDigest(
  ownerId: string,
  convId: string,
  reason?: string,
): Promise<void> {
  try {
    const card = await buildReceptionDigest(ownerId, convId, reason);
    await internal.pushCard(ownerId, card);
  } catch (e) {
    log.warn('reception digest failed', { ownerId, convId, error: String(e) });
  }
}

export async function pushHumanRequestCard(params: {
  ownerId: string;
  convId: string;
  requestId: string;
  requesterId: string;
  reason: string | null;
  expiresAt: string | null;
}): Promise<void> {
  const rows = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, params.requesterId))
    .limit(1);
  const card: CardPayload = {
    kind: 'human_request',
    requestId: params.requestId,
    convId: params.convId,
    requesterName: rows[0]?.name ?? '对方',
    reason: params.reason ?? '',
    expiresAt: params.expiresAt,
  };
  await internal.pushCard(params.ownerId, card);
}
