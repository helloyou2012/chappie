/** 跨端通用格式化工具（日期使用 dayjs，ID 使用 uuid）。 */
import { v4 as uuidv4 } from 'uuid';
import { dayjs } from './datetime';

export function uuid(): string {
  return uuidv4();
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = dayjs(iso);
  if (!d.isValid()) return '';
  const now = dayjs();
  if (d.isSame(now, 'day')) return d.format('HH:mm');
  if (d.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${d.format('HH:mm')}`;
  if (d.isSame(now, 'year')) return d.format('M月D日');
  return d.format('YYYY/M/D');
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = dayjs(iso);
  if (!d.isValid()) return '';
  const diff = d.diff(dayjs());
  // 未来时间（如审批超时）：业务文案保留，相对时长交给 dayjs relativeTime
  if (diff > 0) {
    if (diff < 60_000) return '即将到期';
    return d.fromNow(); // 「2 分钟后」「3 小时后」
  }
  if (-diff < 60_000) return '刚刚';
  return d.fromNow(); // 「2 分钟前」「3 小时前」
}

export function truncate(text: string, max = 40): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return /^[\x00-\x7F]+$/.test(trimmed)
    ? trimmed
        .split(/\s+/)
        .map((s) => s[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : trimmed.slice(0, 2);
}
