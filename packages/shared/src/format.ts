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

/** 头像占位字符：取第一个字符，英文自动大写。 */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return (Array.from(trimmed)[0] ?? '?').toUpperCase();
}

/**
 * 模型有时会把工具调用以文本形式输出（<tool_call>...</tool_call>）。
 * 这类标记不应出现在消息、预览或历史里；客户端渲染时再兜底剥离一次。
 */
export function stripToolCallMarkup(text: string): string {
  let out = text;
  for (const name of ['tool_call', 'tool_calls', 'function_call']) {
    out = out.replace(new RegExp(`<${name}>[\\s\\S]*?(?:</${name}>|$)`, 'gi'), '');
  }
  out = out.replace(/<\|tool_call\|>[\s\S]*?(?:<\|\/tool_call\|>|$)/gi, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
