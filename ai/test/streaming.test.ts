/**
 * 流式模型网关 —— SSE 解析 + 三类 provider 的增量/工具调用累积。
 * 用自定义 ReadableStream 模拟供应商响应，不依赖网络。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { anthropicProvider } from '../src/model-gateway/anthropic';
import { mockProvider } from '../src/model-gateway/mock';
import { openaiChatProvider, openaiResponsesProvider } from '../src/model-gateway/openai';
import { readSse } from '../src/model-gateway/sse';
import type { ToolDef } from '../src/model-gateway/types';

const TOOLS: ToolDef[] = [
  {
    name: 'calendar.read',
    description: '查询日程',
    parameters: { type: 'object', properties: { day: { type: 'string' } } },
  },
];

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('readSse 事件解析', () => {
  test('跨 chunk 截断的事件也能正确拼接', async () => {
    const res = sseResponse([
      'event: message_st',
      'art\ndata: {"a":1}\n\n',
      'data: line1\ndata: line2\n\n',
      'data: [DONE]',
    ]);
    const events = [];
    for await (const ev of readSse(res)) events.push(ev);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: 'message_start', data: '{"a":1}' });
    expect(events[1]?.data).toBe('line1\nline2');
    expect(events[2]?.data).toBe('[DONE]');
  });
});

describe('anthropic 流式', () => {
  test('文本增量 + tool_use JSON 累积', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-x","usage":{"input_tokens":10}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"calendar_read","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"day\\":"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"today\\"}"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":20}}\n\n',
      ])) as unknown as typeof fetch;

    const deltas: string[] = [];
    const r = await anthropicProvider.complete(
      {
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
        stream: true,
        onTextDelta: (d) => deltas.push(d),
      },
      { model: 'claude-x', baseUrl: 'http://mock', apiKey: 'k' },
    );
    expect(deltas.join('')).toBe('你好');
    expect(r.text).toBe('你好');
    expect(r.toolCalls).toEqual([{ id: 'tu_1', name: 'calendar.read', args: { day: 'today' } }]);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(r.model).toBe('claude-x');
  });
});

describe('openai-chat 流式', () => {
  test('content 增量 + tool_calls 按 index 累积', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"model":"gpt-x","choices":[{"delta":{"content":"hello "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"calendar_read","arguments":"{\\"day\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"today\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":6}}\n\n',
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch;

    const deltas: string[] = [];
    const r = await openaiChatProvider.complete(
      {
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
        stream: true,
        onTextDelta: (d) => deltas.push(d),
      },
      { model: 'gpt-x', baseUrl: 'http://mock/v1', apiKey: 'k' },
    );
    expect(deltas.join('')).toBe('hello world');
    expect(r.text).toBe('hello world');
    expect(r.toolCalls[0]?.name).toBe('calendar.read');
    expect(r.toolCalls[0]?.args).toEqual({ day: 'today' });
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 6 });
  });
});

describe('openai-responses 流式', () => {
  test('output_text.delta + function_call 参数', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
        'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"calendar_read","arguments":"{\\"day\\":\\"today\\"}"}}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{"model":"gpt-5","usage":{"input_tokens":7,"output_tokens":8}}}\n\n',
      ])) as unknown as typeof fetch;

    const deltas: string[] = [];
    const r = await openaiResponsesProvider.complete(
      {
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
        stream: true,
        onTextDelta: (d) => deltas.push(d),
      },
      { model: 'gpt-5', baseUrl: 'http://mock/v1', apiKey: 'k' },
    );
    expect(deltas.join('')).toBe('hi');
    expect(r.text).toBe('hi');
    expect(r.toolCalls[0]).toEqual({
      id: 'call_1',
      name: 'calendar.read',
      args: { day: 'today' },
    });
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 8 });
  });
});

describe('mock 流式', () => {
  test('文本按块回调，拼回原文', async () => {
    const deltas: string[] = [];
    const r = await mockProvider.complete(
      {
        system: '你是 alice 的 AI 分身。',
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
        onTextDelta: (d) => deltas.push(d),
        mockHints: { ownerName: 'alice', triggerText: '你好' },
      },
      { model: 'mock-1', baseUrl: '', apiKey: '' },
    );
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe(r.text);
  });
});

describe('anthropic 流式 thinking', () => {
  test('thinking_delta 回调 + signature_delta 累积，与正文分开', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-x","usage":{"input_tokens":10}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先判断意图"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_abc"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"你好"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":30}}\n\n',
      ])) as unknown as typeof fetch;

    const thinkingDeltas: string[] = [];
    const textDeltas: string[] = [];
    const r = await anthropicProvider.complete(
      {
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: TOOLS,
        thinking: true,
        stream: true,
        onTextDelta: (d) => textDeltas.push(d),
        onThinkingDelta: (d) => thinkingDeltas.push(d),
      },
      { model: 'claude-x', baseUrl: 'http://mock', apiKey: 'k' },
    );
    expect(thinkingDeltas.join('')).toBe('先判断意图');
    expect(textDeltas.join('')).toBe('你好');
    expect(r.thinking).toBe('先判断意图');
    expect(r.thinkingSignature).toBe('sig_abc');
    expect(r.text).toBe('你好');
    expect(r.toolCalls).toEqual([]);
  });
});

describe('anthropic 多工具结果分组', () => {
  test('同一轮多个 tool_result 合并进一条 user 消息', async () => {
    let captured: { messages?: { role: string; content: unknown }[] } = {};
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({
          model: 'claude-x',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await anthropicProvider.complete(
      {
        system: 'sys',
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'a', name: 'calendar.read', args: { day: 'today' } },
              { id: 'b', name: 'calendar.read', args: { day: 'tomorrow' } },
            ],
          },
          { role: 'tool', toolCallId: 'a', content: 'A' },
          { role: 'tool', toolCallId: 'b', content: 'B' },
        ],
        tools: TOOLS,
      },
      { model: 'claude-x', baseUrl: 'http://mock', apiKey: 'k' },
    );
    const msgs = captured.messages ?? [];
    expect(msgs).toHaveLength(3);
    const last = msgs[2] as { role: string; content: { type: string; tool_use_id: string }[] };
    expect(last.role).toBe('user');
    expect(last.content.map((b) => b.tool_use_id)).toEqual(['a', 'b']);
  });
});
