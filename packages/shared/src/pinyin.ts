/**
 * 联系人分组首字母（A–Z / #）。
 * 中文取拼音首字母，英文取大写，数字与符号归入 #。
 */
import { pinyin } from 'pinyin-pro';

export function nameInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  if (!first) return '#';
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  if (!/[一-龥]/.test(first)) return '#';
  const letter = pinyin(first, { pattern: 'first', toneType: 'none' })[0]?.toUpperCase();
  return letter && /^[A-Z]$/.test(letter) ? letter : '#';
}

/** 按首字母分组并排序：A–Z 在前，# 最后 */
export function groupByInitial<T>(
  items: T[],
  nameOf: (item: T) => string,
): { title: string; data: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = nameInitial(nameOf(item));
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([title, data]) => ({ title, data }));
}
