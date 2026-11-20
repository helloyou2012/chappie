import { type CalendarItem, dayjs } from '@chappie/shared';

/** 日历视图锚点日期（dayjs 对象不可变，可直接作为 state） */
export type Dayjs = ReturnType<typeof dayjs>;

export type CalendarView = 'day' | 'week' | 'month';

/** 时间轴每小时高度（px）与整日高度 */
export const HOUR_HEIGHT = 56;
export const DAY_HEIGHT = HOUR_HEIGHT * 24;
/** 日程默认时长（分钟）：数据模型只有开始时间 */
export const DEFAULT_EVENT_MINUTES = 30;
/** 点击空白新建 / 时间取整的步长 */
export const MINUTE_STEP = 30;

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 归一化后的日程：
 * - `date` 仅保留合法 YYYY-MM-DD，历史数据里的自由文本置空（侧栏「未安排」）
 * - `startMin` 为当天第几分钟；无法解析时置空
 * - `index` 保留原始下标，删除接口按 index 定位
 */
export type CalendarStatus = 'pending' | 'confirmed' | 'cancelled';

export interface ScheduleEvent {
  key: string;
  index: number;
  title: string;
  date: string | null;
  rawTime: string;
  startMin: number | null;
  endMin: number | null;
  status: CalendarStatus;
  attendees: string[];
}

export function normalizeEvent(item: CalendarItem, index: number): ScheduleEvent {
  const date = normalizeDate(item.date);
  const match = /^(\d{1,2}):(\d{2})/.exec(item.time.trim());
  let startMin: number | null = null;
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      startMin = hour * 60 + minute;
    }
  }
  const endMin = startMin == null ? null : Math.min(startMin + DEFAULT_EVENT_MINUTES, 24 * 60);
  return {
    key: item.id ?? `calendar-${index}`,
    index,
    title: item.title,
    date,
    rawTime: item.time,
    startMin,
    endMin,
    status: item.status ?? 'confirmed',
    attendees: item.attendees ?? [],
  };
}

function normalizeDate(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = dayjs(date);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.min(total, 24 * 60));
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

export function dateKey(day: Dayjs): string {
  return day.format('YYYY-MM-DD');
}

/** 周日作为一周的第一天（与「日 一 二 … 六」表头一致） */
export function startOfWeek(day: Dayjs): Dayjs {
  return day.startOf('day').subtract(day.day(), 'day');
}

/** 月视图固定 6 行 × 7 列，从当月 1 日所在周的周日开始 */
export function monthGridDays(month: Dayjs): Dayjs[] {
  const start = startOfWeek(month.startOf('month'));
  return Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));
}

export function eventRange(event: ScheduleEvent): string {
  if (event.startMin == null || event.endMin == null) return event.rawTime;
  return `${formatMinutes(event.startMin)} - ${formatMinutes(event.endMin)}`;
}

export function formatFullDate(date: string | null): string {
  if (!date) return '未安排日期';
  const day = dayjs(date);
  if (!day.isValid()) return date;
  return day.isSame(dayjs(), 'day')
    ? `今天 · ${day.format('YYYY年M月D日')}`
    : day.format('YYYY年M月D日');
}

export function monthLabel(month: Dayjs): string {
  return `${month.year()}年${month.month() + 1}月`;
}

/** 工具栏标题：日 / 周 / 月三种粒度 */
export function viewTitle(view: CalendarView, cursor: Dayjs): string {
  if (view === 'day') return cursor.format('YYYY年M月D日');
  if (view === 'month') return monthLabel(cursor);
  const start = startOfWeek(cursor);
  const end = start.add(6, 'day');
  if (start.isSame(end, 'month')) {
    return `${start.format('YYYY年M月D日')} - ${end.format('D日')}`;
  }
  if (start.isSame(end, 'year')) {
    return `${start.format('YYYY年M月D日')} - ${end.format('M月D日')}`;
  }
  return `${start.format('YYYY年M月D日')} - ${end.format('YYYY年M月D日')}`;
}

/** 新建日程的默认时间：今天取下一个半点，其余日期取 09:00 */
export function nextSlotTime(day: Dayjs): string {
  const now = dayjs();
  if (!day.isSame(now, 'day')) return '09:00';
  const rounded = Math.ceil((now.hour() * 60 + now.minute()) / MINUTE_STEP) * MINUTE_STEP;
  return formatMinutes(Math.min(rounded, 23 * 60 + 30));
}

export function timezoneLabel(): string {
  const offset = -new Date().getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const minutes = abs % 60;
  return `GMT${sign}${Math.floor(abs / 60)}${minutes ? `:${pad2(minutes)}` : ''}`;
}
