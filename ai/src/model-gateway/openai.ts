/**
 * OpenAI 协议适配（两种）：
 *   1. Chat Completions —— POST {base}/chat/completions（兼容绝大多数 OpenAI 风格网关）
 *   2. Responses —— POST {base}/responses（OpenAI 新一代接口）
 * baseUrl 形如 https://api.openai.com/v1
 */

import { assertStreamOk, readSse } from './sse';
import type { ChatMessage, CompleteRequest, CompleteResult, Provider, ToolCall } from './types';
import { createToolNameMap, estimateCost, safeJsonParse } from './types';

// ---------------------------------------------------------------------------
// Chat Completions
// ---------------------------------------------------------------------------

function toChatMessage(m: ChatMessage, toWire: (name: string) => string): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: toWire(tc.name), arguments: JSON.stringify(tc.args) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

export const openaiChatProvider: Provider = {
  name: 'openai-chat',
  async complete(req: CompleteRequest, ctx) {
    if (req.stream && req.onTextDelta) return streamOpenaiChat(req, ctx);
    const names = createToolNameMap(req.tools);
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: [
        { role: 'system', content: req.system },
        ...req.messages.map((m) => toChatMessage(m, names.toWire)),
      ],
      temperature: req.temperature ?? 0.6,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: names.toWire(t.name),
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (req.maxTokens) body.max_tokens = req.maxTokens;

    const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`openai-chat ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: {
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = data.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: names.fromWire(tc.function.name),
      args: safeJsonParse<Record<string, unknown>>(tc.function.arguments, {}),
    }));
    const usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
    return {
      text: msg.content ?? '',
      // DeepSeek 等 OpenAI 兼容网关用 reasoning_content 返回思考
      thinking: msg.reasoning_content ?? undefined,
      toolCalls,
      usage,
      provider: 'openai-chat',
      model: data.model ?? ctx.model,
      costUsd: estimateCost(ctx.model, usage),
    };
  },
};

/** OpenAI Chat Completions 流式：delta.content 实时回调；tool_calls 按 index 累积。 */
async function streamOpenaiChat(
  req: CompleteRequest,
  ctx: { model: string; baseUrl: string; apiKey: string },
): Promise<CompleteResult> {
  const names = createToolNameMap(req.tools);
  const body: Record<string, unknown> = {
    model: ctx.model,
    messages: [
      { role: 'system', content: req.system },
      ...req.messages.map((m) => toChatMessage(m, names.toWire)),
    ],
    temperature: req.temperature ?? 0.6,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: names.toWire(t.name),
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
  if (req.maxTokens) body.max_tokens = req.maxTokens;

  const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  await assertStreamOk(res, 'openai-chat');

  let text = '';
  let thinkingText: string | undefined;
  let model = ctx.model;
  let inputTokens = 0;
  let outputTokens = 0;
  const calls = new Map<number, { id: string; name: string; args: string }>();

  for await (const ev of readSse(res)) {
    if (ev.data === '[DONE]') break;
    const data = safeJsonParse<{
      model?: string;
      choices?: {
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: {
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(ev.data, {});
    if (data.model) model = data.model;
    if (data.usage) {
      inputTokens = data.usage.prompt_tokens ?? inputTokens;
      outputTokens = data.usage.completion_tokens ?? outputTokens;
    }
    const delta = data.choices?.[0]?.delta;
    if (delta?.reasoning_content) {
      thinkingText = (thinkingText ?? '') + delta.reasoning_content;
      req.onThinkingDelta?.(delta.reasoning_content);
    }
    if (delta?.content) {
      text += delta.content;
      req.onTextDelta?.(delta.content);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const current = calls.get(idx) ?? { id: '', name: '', args: '' };
      if (tc.id) current.id = tc.id;
      if (tc.function?.name) current.name += tc.function.name;
      if (tc.function?.arguments) current.args += tc.function.arguments;
      calls.set(idx, current);
    }
  }

  const toolCalls: ToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, c]) => c.name)
    .map(([, c]) => ({
      id: c.id,
      name: names.fromWire(c.name),
      args: safeJsonParse<Record<string, unknown>>(c.args, {}),
    }));
  const usage = { inputTokens, outputTokens };
  return {
    text,
    thinking: thinkingText,
    toolCalls,
    usage,
    provider: 'openai-chat',
    model,
    costUsd: estimateCost(ctx.model, usage),
  };
}

// ---------------------------------------------------------------------------
// Responses API
// ---------------------------------------------------------------------------

type ResponsesInputItem =
  | { role: 'user' | 'assistant'; content: { type: 'input_text' | 'output_text'; text: string }[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

function toResponsesInput(m: ChatMessage, toWire: (name: string) => string): ResponsesInputItem[] {
  if (m.role === 'tool') {
    return [{ type: 'function_call_output', call_id: m.toolCallId ?? '', output: m.content }];
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return m.toolCalls.map((tc) => ({
      type: 'function_call' as const,
      call_id: tc.id,
      name: toWire(tc.name),
      arguments: JSON.stringify(tc.args),
    }));
  }
  return [
    {
      role: m.role,
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
    },
  ];
}

export const openaiResponsesProvider: Provider = {
  name: 'openai-responses',
  async complete(req: CompleteRequest, ctx) {
    if (req.stream && req.onTextDelta) return streamOpenaiResponses(req, ctx);
    const names = createToolNameMap(req.tools);
    const body: Record<string, unknown> = {
      model: ctx.model,
      instructions: req.system,
      input: req.messages.flatMap((m) => toResponsesInput(m, names.toWire)),
      temperature: req.temperature ?? 0.6,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        name: names.toWire(t.name),
        description: t.description,
        parameters: t.parameters,
      }));
    }
    if (req.maxTokens) body.max_output_tokens = req.maxTokens;

    const res = await fetch(`${ctx.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`openai-responses ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      model?: string;
      output?: (
        | { type: 'message'; content?: { type: string; text?: string }[] }
        | { type: 'function_call'; call_id: string; name: string; arguments: string }
      )[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const item of data.output ?? []) {
      if (item.type === 'message') {
        for (const c of item.content ?? []) {
          if (c.type === 'output_text' && c.text) text += c.text;
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id,
          name: names.fromWire(item.name),
          args: safeJsonParse<Record<string, unknown>>(item.arguments, {}),
        });
      }
    }
    const usage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
    return {
      text,
      toolCalls,
      usage,
      provider: 'openai-responses',
      model: data.model ?? ctx.model,
      costUsd: estimateCost(ctx.model, usage),
    };
  },
};

/** Responses API 流式：output_text.delta 实时回调；function_call 参数按 item_id 累积。 */
async function streamOpenaiResponses(
  req: CompleteRequest,
  ctx: { model: string; baseUrl: string; apiKey: string },
): Promise<CompleteResult> {
  const names = createToolNameMap(req.tools);
  const body: Record<string, unknown> = {
    model: ctx.model,
    instructions: req.system,
    input: req.messages.flatMap((m) => toResponsesInput(m, names.toWire)),
    temperature: req.temperature ?? 0.6,
    stream: true,
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      name: names.toWire(t.name),
      description: t.description,
      parameters: t.parameters,
    }));
  }
  if (req.maxTokens) body.max_output_tokens = req.maxTokens;

  const res = await fetch(`${ctx.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  await assertStreamOk(res, 'openai-responses');

  let text = '';
  let model = ctx.model;
  let inputTokens = 0;
  let outputTokens = 0;
  const calls = new Map<string, { callId: string; name: string; args: string }>();

  for await (const ev of readSse(res)) {
    if (ev.data === '[DONE]') break;
    const data = safeJsonParse<Record<string, unknown>>(ev.data, {});
    const type = (ev.event ?? (data.type as string | undefined) ?? '') as string;
    if (type === 'error' || type === 'response.failed') {
      throw new Error(`openai-responses stream error: ${ev.data.slice(0, 300)}`);
    }
    if (type === 'response.output_text.delta') {
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (delta) {
        text += delta;
        req.onTextDelta?.(delta);
      }
      continue;
    }
    if (type === 'response.output_item.added') {
      const item = data.item as
        | { type?: string; id?: string; call_id?: string; name?: string; arguments?: string }
        | undefined;
      if (item?.type === 'function_call') {
        const key = item.id ?? item.call_id ?? '';
        calls.set(key, {
          callId: item.call_id ?? item.id ?? '',
          name: item.name ?? '',
          args: item.arguments ?? '',
        });
      }
      continue;
    }
    if (type === 'response.function_call_arguments.delta') {
      const key = typeof data.item_id === 'string' ? data.item_id : '';
      const current = calls.get(key);
      if (current && typeof data.delta === 'string') current.args += data.delta;
      continue;
    }
    if (type === 'response.function_call_arguments.done') {
      const key = typeof data.item_id === 'string' ? data.item_id : '';
      const current = calls.get(key);
      if (current && typeof data.arguments === 'string') current.args = data.arguments;
      continue;
    }
    if (type === 'response.completed') {
      const response = data.response as
        | {
            model?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          }
        | undefined;
      if (response?.model) model = response.model;
      inputTokens = response?.usage?.input_tokens ?? inputTokens;
      outputTokens = response?.usage?.output_tokens ?? outputTokens;
    }
  }

  const toolCalls: ToolCall[] = [...calls.values()]
    .filter((c) => c.name)
    .map((c) => ({
      id: c.callId,
      name: names.fromWire(c.name),
      args: safeJsonParse<Record<string, unknown>>(c.args, {}),
    }));
  const usage = { inputTokens, outputTokens };
  return {
    text,
    toolCalls,
    usage,
    provider: 'openai-responses',
    model,
    costUsd: estimateCost(ctx.model, usage),
  };
}
