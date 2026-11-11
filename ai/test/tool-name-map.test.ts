/** 工具名线上映射：Anthropic/OpenAI 要求函数名 ^[a-zA-Z0-9_-]+$（内置 id 含点号）。 */
import { describe, expect, test } from 'bun:test';
import { createToolNameMap } from '../src/model-gateway/types';

const tool = (name: string) => ({ name, description: name, parameters: {} });

describe('createToolNameMap', () => {
  test('点号映射为下划线，并能还原', () => {
    const map = createToolNameMap([tool('calendar.read'), tool('payment.send')]);
    expect(map.toWire('calendar.read')).toBe('calendar_read');
    expect(map.toWire('payment.send')).toBe('payment_send');
    expect(map.fromWire('calendar_read')).toBe('calendar.read');
    expect(map.fromWire('payment_send')).toBe('payment.send');
  });

  test('线上名满足供应商正则约束', () => {
    const names = ['calendar.read', 'todo.add', 'web.search', 'translate', 'custom-tool_1'];
    const map = createToolNameMap(names.map(tool));
    for (const n of names) {
      expect(map.toWire(n)).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  test('命名冲突时附加序号，保证一一映射', () => {
    const map = createToolNameMap([tool('a.b'), tool('a_b')]);
    const first = map.toWire('a.b');
    const second = map.toWire('a_b');
    expect(first).toBe('a_b');
    expect(second).toBe('a_b_2');
    expect(map.fromWire(first)).toBe('a.b');
    expect(map.fromWire(second)).toBe('a_b');
  });

  test('无工具或未知名称时原样透传', () => {
    const empty = createToolNameMap();
    expect(empty.toWire('calendar.read')).toBe('calendar.read');
    expect(empty.fromWire('x')).toBe('x');

    const map = createToolNameMap([tool('calendar.read')]);
    expect(map.toWire('unknown.tool')).toBe('unknown.tool');
    expect(map.fromWire('unknown')).toBe('unknown');
  });
});
