/**
 * 定时与主动任务 —— 设计方案 §27.7：
 *   PG 任务表 + 定时扫描（scheduler_job）；分身日报、审批超时清理。
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { DailyReport } from '@chappie/contract';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { sweepExpiredApprovals } from './approval';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { log, newId } from './common/log';
import {
  agentTask,
  approval,
  avatar as avatarTable,
  calendarReminder,
  dailyReport,
  feedback,
  schedulerJob,
  toolData,
} from './db/schema';
import { sweepOrphanTasks } from './recovery';
import { normalizeCalendarItem } from './tool-gateway';

const TICK_MS = 30_000;
const REPORT_HOUR_MINUTE = '09:00';
/** 日程提醒提前量（分钟） */
const CALENDAR_REMIND_AHEAD_MIN = 10;
/** 超过开始时刻多久内仍补发提醒（分钟）；再晚即落入时效线丢弃 */
const CALENDAR_REMIND_GRACE_MIN = 15;
/** 每 tick 最多提醒条数（避免扫库风暴） */
const CALENDAR_REMIND_BATCH = 50;

export async function runScheduler(signal?: AbortSignal): Promise<void> {
  log.info('scheduler started');
  while (!signal?.aborted) {
    try {
      await sweepExpiredApprovals();
      await runDueReports();
      // 日程到点提醒（调度触发：分身第一次「主动开口」—— 设计方案 §7.3 定时/事件触发）
      await sweepCalendarReminders();
      // 孤儿任务恢复（租约过期 = worker 崩溃 —— 设计方案 §27.4 中断恢复）
      await sweepOrphanTasks();
    } catch (e) {
      log.error('scheduler tick failed', { error: String(e) });
    }
    await sleep(TICK_MS);
  }
  log.info('scheduler stopped');
}

// ---------------------------------------------------------------------------
// 日程提醒：toolData(calendar) 扫描 + calendar_reminder 台账去重
// ---------------------------------------------------------------------------

export type ReminderWindow = 'wait' | 'fire' | 'missed';

/** 纯函数：某日程在当前时刻应等待 / 提醒 / 过时效丢弃（时效线 —— 设计方案 §26.3） */
export function reminderWindow(startAt: Date, now: Date = new Date()): ReminderWindow {
  const remindAt = startAt.getTime() - CALENDAR_REMIND_AHEAD_MIN * 60_000;
  const t = now.getTime();
  if (t < remindAt) return 'wait';
  if (t > startAt.getTime() + CALENDAR_REMIND_GRACE_MIN * 60_000) return 'missed';
  return 'fire';
}

export async function sweepCalendarReminders(): Promise<number> {
  // 有日程数据的分身（tool_data 只有真实写入过才会有行）
  const avatars = await db
    .select({
      avatarId: toolData.avatarId,
      ownerId: avatarTable.ownerId,
      data: toolData.data,
    })
    .from(toolData)
    .innerJoin(avatarTable, eq(avatarTable.id, toolData.avatarId))
    .where(and(eq(toolData.kind, 'calendar'), eq(avatarTable.status, 'active')));

  let fired = 0;
  outer: for (const row of avatars) {
    const raw = Array.isArray(row.data) ? (row.data as Record<string, unknown>[]) : [];
    const items = raw
      .map((x) =>
        normalizeCalendarItem({
          id: typeof x.id === 'string' ? x.id : undefined,
          title: String(x.title ?? ''),
          time: String(x.time ?? ''),
          date: typeof x.date === 'string' ? x.date : null,
          status:
            x.status === 'pending' || x.status === 'cancelled' || x.status === 'confirmed'
              ? x.status
              : undefined,
          attendees: Array.isArray(x.attendees)
            ? x.attendees.map((v) => String(v)).filter(Boolean)
            : [],
        }),
      )
      .filter((x) => x.date && x.status === 'confirmed');
    for (const item of items) {
      const start = dayjs(`${item.date} ${item.time}`);
      if (!start.isValid()) continue;
      const window = reminderWindow(start.toDate());
      if (window === 'wait') continue;
      if (window === 'missed') {
        // 时效线外：写台账（错过可见），不打扰主人
        await db
          .insert(calendarReminder)
          .values({
            id: newId('cr'),
            avatarId: row.avatarId,
            ownerId: row.ownerId,
            entryId: item.id,
            title: item.title,
            startAt: start.toDate(),
            remindAt: start.subtract(CALENDAR_REMIND_AHEAD_MIN, 'minute').toDate(),
            status: 'missed',
          })
          .onConflictDoNothing();
        continue;
      }
      // fire：occurrence 唯一键条件认领 —— 只有真正插入成功的那一次才推卡片
      const inserted = await db
        .insert(calendarReminder)
        .values({
          id: newId('cr'),
          avatarId: row.avatarId,
          ownerId: row.ownerId,
          entryId: item.id,
          title: item.title,
          startAt: start.toDate(),
          remindAt: start.subtract(CALENDAR_REMIND_AHEAD_MIN, 'minute').toDate(),
          status: 'fired',
        })
        .onConflictDoNothing()
        .returning({ id: calendarReminder.id });
      if (inserted.length === 0) continue;

      const minutes = start.diff(dayjs(), 'minute');
      const when = minutes > 0 ? `${minutes} 分钟后开始` : '已经开始';
      try {
        await internal.pushCard(row.ownerId, {
          kind: 'calendar_reminder',
          entryId: item.id,
          title: item.title,
          startAt: start.toISOString(),
          summary: `你安排的日程「${item.title}」${start.format('MM-DD HH:mm')}，${when}。`,
        });
        fired += 1;
        log.info('calendar reminder fired', {
          avatarId: row.avatarId,
          entryId: item.id,
          title: item.title,
        });
      } catch (e) {
        log.error('calendar reminder push failed', {
          avatarId: row.avatarId,
          entryId: item.id,
          error: String(e),
        });
      }
      if (fired >= CALENDAR_REMIND_BATCH) break outer;
    }
  }
  return fired;
}

async function runDueReports(): Promise<void> {
  const jobs = await db
    .select({
      id: schedulerJob.id,
      avatarId: schedulerJob.avatarId,
      schedule: schedulerJob.schedule,
      ownerId: avatarTable.ownerId,
      avatarName: avatarTable.name,
    })
    .from(schedulerJob)
    .innerJoin(avatarTable, eq(avatarTable.id, schedulerJob.avatarId))
    .where(
      and(
        eq(schedulerJob.kind, 'daily_report'),
        eq(schedulerJob.enabled, true),
        or(isNull(schedulerJob.lastRunAt), sql`${schedulerJob.lastRunAt}::date < CURRENT_DATE`),
      ),
    );

  const hhmm = dayjs().format('HH:mm');
  for (const job of jobs) {
    if (hhmm < (job.schedule || REPORT_HOUR_MINUTE)) continue;
    await generateDailyReport(job.avatarId, job.ownerId, job.avatarName).catch((e) =>
      log.error('daily report failed', { avatarId: job.avatarId, error: String(e) }),
    );
    await db.update(schedulerJob).set({ lastRunAt: sql`now()` }).where(eq(schedulerJob.id, job.id));
  }
}

export async function generateDailyReport(
  avatarId: string,
  ownerId: string,
  _avatarName: string,
): Promise<DailyReport | null> {
  const day = dayjs.utc().format('YYYY-MM-DD');

  const statsRows = await db
    .select({
      replied: sql<number>`count(*) FILTER (WHERE ${agentTask.status} = 'completed' AND ${agentTask.decision}->>'action' = 'reply')::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${agentTask.status} = 'completed')::int`,
      handed: sql<number>`count(*) FILTER (WHERE ${agentTask.status} = 'handed_over')::int`,
      waitingApproval: sql<number>`count(*) FILTER (WHERE ${agentTask.status} = 'waiting_approval')::int`,
      cost: sql<number>`COALESCE(SUM(${agentTask.costUsd}), 0)::float8`,
    })
    .from(agentTask)
    .where(and(eq(agentTask.avatarId, avatarId), sql`${agentTask.createdAt} >= CURRENT_DATE`));
  const stats = statsRows[0] ?? {
    replied: 0,
    completed: 0,
    handed: 0,
    waiting_approval: 0,
    cost: 0,
  };

  const feedbackRows = await db
    .select({
      accepted: sql<number>`count(*) FILTER (WHERE ${feedback.type} = 'accept')::int`,
      rejected: sql<number>`count(*) FILTER (WHERE ${feedback.type} = 'reject')::int`,
    })
    .from(feedback)
    .innerJoin(agentTask, eq(agentTask.id, feedback.taskId))
    .where(and(eq(agentTask.avatarId, avatarId), sql`${feedback.createdAt} >= CURRENT_DATE`));
  const fb = feedbackRows[0] ?? { accepted: 0, rejected: 0 };

  const pending = await db
    .select({ id: approval.id, title: approval.title, toolName: approval.toolName })
    .from(approval)
    .where(and(eq(approval.avatarId, avatarId), eq(approval.status, 'pending')))
    .orderBy(desc(approval.createdAt))
    .limit(5);

  const acceptedRate =
    fb.accepted + fb.rejected > 0 ? fb.accepted / (fb.accepted + fb.rejected) : 0;

  const summaryParts = [
    `今天我替你回复了 ${stats.replied} 条消息，完成 ${stats.completed} 个任务`,
    stats.handed > 0 ? `，有 ${stats.handed} 条转交你处理` : '',
    pending.length > 0 ? `；还有 ${pending.length} 项操作等你确认` : '',
    acceptedRate > 0 ? `。草稿采纳率 ${(acceptedRate * 100).toFixed(0)}%` : '',
    stats.cost > 0 ? `，花费 $${stats.cost.toFixed(4)}` : '',
    '。',
  ];
  const summary = summaryParts.join('');

  const pendingDecisions = pending.map((p) => ({
    kind: 'approval',
    title: p.title,
    detail: `能力：${p.toolName}`,
  }));

  const reportId = newId('r');
  const reportStats: DailyReport['stats'] = {
    repliedCount: stats.replied,
    tasksCompleted: stats.completed,
    draftsSent: fb.accepted,
    draftsDiscarded: fb.rejected,
    handovers: stats.handed,
    approvalsPending: pending.length,
    acceptedRate,
    costUsd: stats.cost,
  };
  const rows = await db
    .insert(dailyReport)
    .values({
      id: reportId,
      avatarId,
      ownerId,
      day,
      summary,
      stats: reportStats,
      pendingDecisions,
    })
    .onConflictDoUpdate({
      target: [dailyReport.avatarId, dailyReport.day],
      set: {
        summary,
        stats: reportStats,
        pendingDecisions,
        createdAt: sql`now()`,
      },
    })
    .returning({ id: dailyReport.id, createdAt: dailyReport.createdAt });

  const { msgId } = await internal.pushCard(ownerId, {
    kind: 'report',
    reportId: rows[0]?.id ?? reportId,
    day,
    summary,
  });
  await db
    .update(dailyReport)
    .set({ cardMsgId: msgId })
    .where(eq(dailyReport.id, rows[0]?.id ?? reportId));

  log.info('daily report generated', { avatarId, day, cardMsgId: msgId });

  const reportRows = await db
    .select()
    .from(dailyReport)
    .where(and(eq(dailyReport.avatarId, avatarId), eq(dailyReport.day, day)))
    .limit(1);
  const r = reportRows[0];
  if (!r) return null;
  return {
    id: r.id,
    avatarId: r.avatarId,
    day: r.day,
    summary: r.summary,
    stats: r.stats,
    pendingDecisions: r.pendingDecisions,
    cardMsgId: r.cardMsgId,
    createdAt: dayjs(r.createdAt).toISOString(),
  };
}
