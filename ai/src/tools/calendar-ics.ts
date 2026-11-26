/**
 * ICS 日历订阅（无需 OAuth）：
 *   calendar.subscribe   L1 保存 ICS 地址并立即同步
 *   calendar.sync        L0 手动同步
 *   calendar.unsubscribe L2 移除订阅及其事件
 * 事件写入 tool_data(calendar)，与内置日程同一份数据；scheduler 每小时自动同步。
 */
import { createHash } from 'node:crypto';
import type { CalendarItem } from '@chappie/contract';
import { eq } from 'drizzle-orm';
import * as ical from 'node-ical';
import { z } from 'zod';
import { dayjs } from '../common/datetime';
import { db } from '../common/db';
import { log, newId } from '../common/log';
import { toolData } from '../db/schema';
import { readToolData, writeToolData } from '../tool-data';
import type { BuiltinTool } from '../tool-gateway';
import { assertPublicUrl, fetchPublicText } from './web';

const KIND = 'calendar_sources';
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 30;

interface IcsSource {
  id: string;
  url: string;
  name: string;
  lastSyncedAt?: string;
}

interface IcsEventLike {
  type?: string;
  uid?: string;
  summary?: string;
  start?: Date;
  end?: Date;
  datetype?: string;
  exdate?: Record<string, Date | string>;
  rrule?: { between: (after: Date, before: Date, inclusive?: boolean) => Date[] };
}

function sourcePrefix(sourceId: string): string {
  return `ics_${sourceId}_`;
}

function eventKey(sourceId: string, uid: string, when: Date): string {
  const hash = createHash('sha1')
    .update(`${sourceId}|${uid}|${when.toISOString()}`)
    .digest('hex')
    .slice(0, 16);
  return `ics_${sourceId}_${hash}`;
}

async function loadSources(avatarId: string): Promise<IcsSource[]> {
  const rows = await readToolData<IcsSource[]>(avatarId, KIND, []);
  return Array.isArray(rows) ? rows : [];
}

async function saveSources(avatarId: string, sources: IcsSource[]): Promise<void> {
  await writeToolData(avatarId, KIND, sources);
}

/** 纯解析：ICS 文本 → 未来 30 天内的 CalendarItem（含简单 RRULE 展开与 EXDATE 排除） */
export function parseIcsToItems(text: string, sourceId: string, now = dayjs()): CalendarItem[] {
  const parsed = ical.parseICS(text) as Record<string, unknown>;
  const windowStart = now.subtract(1, 'day').startOf('day');
  const windowEnd = now.add(WINDOW_DAYS, 'day').endOf('day');
  const items: CalendarItem[] = [];

  for (const raw of Object.values(parsed)) {
    const ev = raw as IcsEventLike;
    if (ev?.type !== 'VEVENT' || !(ev.start instanceof Date)) continue;
    const uid = ev.uid ?? ev.summary ?? 'event';
    const start = dayjs(ev.start);
    const exdates = new Set(
      Object.values(ev.exdate ?? {}).map((d) => dayjs(d as Date).format('YYYY-MM-DD HH:mm')),
    );
    const occurrences: Date[] = [];
    if (ev.rrule) {
      for (const d of ev.rrule.between(windowStart.toDate(), windowEnd.toDate(), true)) {
        if (exdates.has(dayjs(d).format('YYYY-MM-DD HH:mm'))) continue;
        occurrences.push(d);
      }
    } else if (start.isAfter(windowStart) && start.isBefore(windowEnd)) {
      occurrences.push(ev.start);
    }
    for (const when of occurrences) {
      const d = dayjs(when);
      items.push({
        id: eventKey(sourceId, uid, when),
        title: ev.summary ?? '（无标题日程）',
        date: d.format('YYYY-MM-DD'),
        time: ev.datetype === 'date' ? '00:00' : d.format('HH:mm'),
        status: 'confirmed',
        attendees: [],
      });
    }
  }
  return items;
}

async function syncSource(
  avatarId: string,
  source: IcsSource,
): Promise<{ count: number; calendar: number }> {
  const { text } = await fetchPublicText(source.url);
  const items = parseIcsToItems(text, source.id);

  const existing = await readToolData<CalendarItem[]>(avatarId, 'calendar', []);
  const prefix = sourcePrefix(source.id);
  const kept = existing.filter((x) => !(typeof x.id === 'string' && x.id.startsWith(prefix)));
  const next = [...kept, ...items];
  await writeToolData(avatarId, 'calendar', next);
  return { count: items.length, calendar: next.length };
}

async function syncSources(
  avatarId: string,
  sources: IcsSource[],
): Promise<{ synced: number; failed: number; items: number }> {
  let synced = 0;
  let failed = 0;
  let items = 0;
  for (const source of sources) {
    try {
      const result = await syncSource(avatarId, source);
      source.lastSyncedAt = new Date().toISOString();
      items += result.count;
      synced += 1;
    } catch (e) {
      failed += 1;
      log.warn('ics sync failed', {
        avatarId,
        source: source.name,
        error: String(e).slice(0, 200),
      });
    }
  }
  return { synced, failed, items };
}

/** scheduler 每小时同步所有订阅；返回同步的订阅数 */
let lastSweepAt = 0;
export async function sweepCalendarSources(): Promise<number> {
  if (Date.now() - lastSweepAt < SYNC_INTERVAL_MS) return 0;
  lastSweepAt = Date.now();
  const rows = await db
    .select({ avatarId: toolData.avatarId, data: toolData.data })
    .from(toolData)
    .where(eq(toolData.kind, KIND));
  let total = 0;
  for (const row of rows) {
    const sources = (Array.isArray(row.data) ? row.data : []) as IcsSource[];
    const due = sources.filter(
      (s) => !s.lastSyncedAt || Date.now() - Date.parse(s.lastSyncedAt) >= SYNC_INTERVAL_MS,
    );
    if (due.length === 0) continue;
    const result = await syncSources(row.avatarId, due).catch(() => null);
    if (result) total += result.synced;
    await saveSources(row.avatarId, sources);
  }
  return total;
}

export const calendarIcsTools: BuiltinTool[] = [
  {
    id: 'calendar.subscribe',
    name: '订阅日历',
    description: '订阅一个 ICS 日历地址（公开或带密钥的 https 链接），并立即同步未来 30 天事件',
    risk: 'L1',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'ICS 订阅地址（http/https）' },
        name: { type: 'string', description: '订阅名称，可选' },
      },
    },
    validate: z.object({
      url: z.string().url().max(2000),
      name: z.string().min(1).max(80).optional(),
    }),
    async exec(args, ctx) {
      const url = String(args.url);
      assertPublicUrl(url);
      const name = String(args.name ?? url).slice(0, 80);
      const sources = await loadSources(ctx.avatarId);
      const existing = sources.find((s) => s.url === url);
      const source: IcsSource = existing ?? {
        id: newId('ics'),
        url,
        name,
        lastSyncedAt: undefined,
      };
      if (!existing) {
        sources.push(source);
        await saveSources(ctx.avatarId, sources);
      }
      try {
        const result = await syncSource(ctx.avatarId, source);
        source.lastSyncedAt = new Date().toISOString();
        await saveSources(ctx.avatarId, sources);
        return {
          ok: true,
          sourceId: source.id,
          items: result.count,
          summary: `已订阅「${name}」，同步到 ${result.count} 个未来日程。`,
        };
      } catch (e) {
        await saveSources(ctx.avatarId, sources);
        return {
          ok: false,
          sourceId: source.id,
          summary: `订阅已保存，但首次同步失败：${String(e).slice(0, 200)}`,
        };
      }
    },
  },
  {
    id: 'calendar.sync',
    name: '同步日历订阅',
    description: '手动同步所有（或指定）ICS 订阅',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '只看包含该关键词的订阅，可选' } },
    },
    validate: z.object({ name: z.string().max(80).optional() }),
    async exec(args, ctx) {
      const all = await loadSources(ctx.avatarId);
      const keyword = String(args.name ?? '').trim();
      const sources = keyword
        ? all.filter((s) => s.name.includes(keyword) || s.url.includes(keyword))
        : all;
      if (sources.length === 0) {
        return { ok: false, summary: '没有匹配的日历订阅。' };
      }
      const result = await syncSources(ctx.avatarId, sources);
      await saveSources(ctx.avatarId, all);
      return {
        ok: result.failed === 0,
        ...result,
        summary: `同步完成：${result.synced} 个订阅成功，${result.failed} 个失败，新增/更新 ${result.items} 个日程。`,
      };
    },
  },
  {
    id: 'calendar.unsubscribe',
    name: '取消日历订阅',
    description: '取消一个 ICS 日历订阅并删除其同步的日程（高风险，需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', description: '订阅名称或地址关键词' } },
    },
    validate: z.object({ name: z.string().min(1).max(200) }),
    async exec(args, ctx) {
      const keyword = String(args.name).trim();
      const sources = await loadSources(ctx.avatarId);
      const source = sources.find((s) => s.name.includes(keyword) || s.url.includes(keyword));
      if (!source) return { ok: false, summary: `没找到订阅「${keyword}」。` };
      const remaining = sources.filter((s) => s.id !== source.id);
      await saveSources(ctx.avatarId, remaining);
      const existing = await readToolData<CalendarItem[]>(ctx.avatarId, 'calendar', []);
      const prefix = sourcePrefix(source.id);
      const next = existing.filter((x) => !(typeof x.id === 'string' && x.id.startsWith(prefix)));
      await writeToolData(ctx.avatarId, 'calendar', next);
      return { ok: true, summary: `已取消订阅「${source.name}」并移除其日程。` };
    },
  },
];
