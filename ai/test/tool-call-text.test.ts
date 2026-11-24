/** 文本形式的工具调用标记：最终文本剥离 + 流式增量过滤。 */
import { describe, expect, test } from 'bun:test';
import { stripToolCallMarkup, ToolCallTextFilter } from '../src/tool-call-text';

describe('stripToolCallMarkup', () => {
  test('移除完整 <tool_call> 块并保留前后正文', () => {
    const text =
      '好的，我来安排。\n<tool_call>{"name":"calendar.create","arguments":{}}</tool_call>\n稍等～';
    expect(stripToolCallMarkup(text)).toBe('好的，我来安排。\n\n稍等～');
  });

  test('移除多个块 / 大小写 / tool_calls 标签', () => {
    const text = '<TOOL_CALL>a</TOOL_CALL>中间<tool_calls>b</tool_calls>结尾';
    expect(stripToolCallMarkup(text)).toBe('中间结尾');
  });

  test('未闭合块剥到文末', () => {
    expect(stripToolCallMarkup('前文<tool_call>{"name":"x"}')).toBe('前文');
  });

  test('普通文本不受影响', () => {
    expect(stripToolCallMarkup('就是普通的一句话 🙂')).toBe('就是普通的一句话 🙂');
  });
});

describe('ToolCallTextFilter 流式过滤', () => {
  const run = (deltas: string[]) => {
    const f = new ToolCallTextFilter();
    let out = '';
    for (const d of deltas) out += f.push(d);
    out += f.flush();
    return out;
  };

  test('跨 delta 的标签也能识别，块内容不输出', () => {
    expect(run(['你好', '<tool', '_call>{"name":"calendar.create"}</tool_call>', '，已完成'])).toBe(
      '你好，已完成',
    );
  });

  test('未闭合的工具块在 flush 时整体丢弃', () => {
    expect(run(['前文<tool_call>{"name":"calendar.create"'])).toBe('前文');
  });

  test('没有标签时保留完整正文', () => {
    expect(run(['流式', '正文', '正常输出'])).toBe('流式正文正常输出');
  });
});
