/** 通用小工具（纯函数）：宽容 JSON、业务 ID。 */
import { describe, expect, test } from 'bun:test';
import { parseJsonSafe } from '../src/common/json';
import { newId, newTraceId } from '../src/common/log';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('parseJsonSafe', () => {
  test('完整 JSON 等价于严格解析', () => {
    expect(parseJsonSafe<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonSafe<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
  });

  test('截断 JSON 宽容恢复已有字段', () => {
    expect(parseJsonSafe<{ amount?: number }>('{"amount": 300')).toEqual({ amount: 300 });
  });

  test('带多余文本时尽力恢复对象', () => {
    expect(parseJsonSafe<{ ok?: boolean }>('{"ok":true} 以上是执行结果')).toEqual({ ok: true });
  });

  test('完全无法解析时返回 undefined', () => {
    expect(parseJsonSafe('这不是 JSON')).toBeUndefined();
    expect(parseJsonSafe('')).toBeUndefined();
  });
});

describe('业务 ID', () => {
  test('newId 使用前缀 + UUIDv7（时间有序）', () => {
    const id = newId('t');
    expect(id.startsWith('t_')).toBe(true);
    expect(id.slice(2)).toMatch(UUID_RE);
  });

  test('同一毫秒内生成的 ID 仍唯一', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId('x')));
    expect(ids.size).toBe(100);
  });

  test('newTraceId 带 trace_ 前缀', () => {
    expect(newTraceId()).toMatch(/^trace_[0-9a-f-]{36}$/i);
  });
});
