/**
 * Anthropic Messages API 适配 —— POST {base}/v1/messages（baseUrl 形如 https://api.anthropic.com）。
 * system 独立字段；tool_use / tool_result 内容块。
 */

import { config } from '../common/config';
import { assertStreamOk, readSse } from './sse';
import type { ChatMessage, CompleteRequest, CompleteResult, Provider, ToolCall } from './types';
import { createToolNameMap, estimateCost, safeJsonParse } from './types';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicBlock[] };

function toAnthropicMessage(
  m: ChatMessage,
  toWire: (name: string) => string,
  includeThinking: boolean,
): AnthropicMessage {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }],
    };
  }
  if (m.role === 'assistant') {
    const blocks: AnthropicBlock[] = [];
    // thinking 开启时，历史轮的 thinking 块必须回传，否则网关报 400
    if (includeThinking && m.thinking) {
      blocks.push({ type: 'thinking', thinking: m.thinking, signature: m.thinkingSignature ?? '' });
    }
    if (m.content) blocks.push({ type: 'text', text: m.content });
    if (m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: toWire(tc.name), input: tc.args });
      }
    }
    if (blocks.length > 0 && (m.toolCalls?.length || includeThinking)) {
      return { role: 'assistant', content: blocks };
    }
  }
  return { role: m.role, content: m.content };
}

/** thinking 请求参数：官方 API 开启时必须带 budget_tokens；不支持的网关收到 disabled 也兼容 */
function thinkingParam(enabled: boolean, budgetTokens: number): Record<string, unknown> {
  return enabled ? { type: 'enabled', budget_tokens: budgetTokens } : { type: 'disabled' };
}

export const anthropicProvider: Provider = {
  name: 'anthropic',
  async complete(req: CompleteRequest, ctx) {
    if (req.stream && req.onTextDelta) return streamAnthropic(req, ctx);
    const names = createToolNameMap(req.tools);
    const thinking = req.thinking === true;
    const baseTokens = req.maxTokens ?? 1024;
    const body: Record<string, unknown> = {
      model: ctx.model,
      // Anthropic 要求 max_tokens > budget_tokens，否则 400
      max_tokens: thinking ? Math.max(baseTokens, config.thinkingBudgetTokens + 512) : baseTokens,
      system: req.system,
      messages: req.messages.map((m) => toAnthropicMessage(m, names.toWire, thinking)),
      // 开启 thinking 时官方要求 temperature=1
      temperature: thinking ? 1 : (req.temperature ?? 0.6),
      thinking: thinkingParam(thinking, config.thinkingBudgetTokens),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: names.toWire(t.name),
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${ctx.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ctx.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      model?: string;
      content?: (
        | { type: 'text'; text: string }
        | { type: 'thinking'; thinking: string; signature: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      )[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    let text = '';
    let thinkingText: string | undefined;
    let thinkingSignature: string | undefined;
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'thinking') {
        thinkingText = (thinkingText ?? '') + block.thinking;
        thinkingSignature = block.signature ?? '';
      } else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: names.fromWire(block.name), args: block.input });
      }
    }
    const usage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
    return {
      text,
      thinking: thinkingText,
      thinkingSignature,
      toolCalls,
      usage,
      provider: 'anthropic',
      model: data.model ?? ctx.model,
      costUsd: estimateCost(ctx.model, usage),
    };
  },
};

/** Anthropic Messages 流式：text_delta 实时回调；tool_use 的 input_json_delta 累积到流结束。 */
async function streamAnthropic(
  req: CompleteRequest,
  ctx: { model: string; baseUrl: string; apiKey: string },
): Promise<CompleteResult> {
  const names = createToolNameMap(req.tools);
  const thinking = req.thinking === true;
  const baseTokens = req.maxTokens ?? 1024;
  const body: Record<string, unknown> = {
    model: ctx.model,
    max_tokens: thinking ? Math.max(baseTokens, config.thinkingBudgetTokens + 512) : baseTokens,
    system: req.system,
    messages: req.messages.map((m) => toAnthropicMessage(m, names.toWire, thinking)),
    temperature: thinking ? 1 : (req.temperature ?? 0.6),
    stream: true,
    thinking: thinkingParam(thinking, config.thinkingBudgetTokens),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: names.toWire(t.name),
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const res = await fetch(`${ctx.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ctx.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  await assertStreamOk(res, 'anthropic');

  type Block =
    | { kind: 'text' }
    | { kind: 'thinking'; thinking: string; signature: string }
    | { kind: 'tool'; id: string; name: string; json: string; initial: Record<string, unknown> };
  const blocks = new Map<number, Block>();
  let text = '';
  let thinkingText: string | undefined;
  let thinkingSignature: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let model = ctx.model;

  for await (const ev of readSse(res)) {
    if (ev.data === '[DONE]') break;
    const data = safeJsonParse<Record<string, unknown>>(ev.data, {});
    const type = (ev.event ?? (data.type as string | undefined) ?? '') as string;
    if (type === 'error') {
      const err = data.error as { message?: string } | undefined;
      throw new Error(`anthropic stream error: ${err?.message ?? ev.data}`);
    }
    if (type === 'message_start') {
      const msg = data.message as { model?: string; usage?: { input_tokens?: number } } | undefined;
      if (msg?.model) model = msg.model;
      inputTokens = msg?.usage?.input_tokens ?? 0;
      continue;
    }
    if (type === 'content_block_start') {
      const index = Number(data.index ?? 0);
      const block = data.content_block as
        | {
            type?: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
            thinking?: string;
            signature?: string;
          }
        | undefined;
      if (block?.type === 'tool_use') {
        blocks.set(index, {
          kind: 'tool',
          id: block.id ?? '',
          name: block.name ?? '',
          json: '',
          initial: block.input ?? {},
        });
      } else if (block?.type === 'thinking') {
        blocks.set(index, {
          kind: 'thinking',
          thinking: block.thinking ?? '',
          signature: block.signature ?? '',
        });
      } else if (block?.type === 'text') {
        blocks.set(index, { kind: 'text' });
      }
      continue;
    }
    if (type === 'content_block_delta') {
      const index = Number(data.index ?? 0);
      const delta = data.delta as
        | {
            type?: string;
            text?: string;
            partial_json?: string;
            thinking?: string;
            signature?: string;
          }
        | undefined;
      if (delta?.type === 'text_delta' && delta.text) {
        text += delta.text;
        req.onTextDelta?.(delta.text);
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        thinkingText = (thinkingText ?? '') + delta.thinking;
        const block = blocks.get(index);
        if (block?.kind === 'thinking') block.thinking += delta.thinking;
        req.onThinkingDelta?.(delta.thinking);
      } else if (delta?.type === 'signature_delta' && delta.signature) {
        thinkingSignature = (thinkingSignature ?? '') + delta.signature;
        const block = blocks.get(index);
        if (block?.kind === 'thinking') block.signature += delta.signature;
      } else if (delta?.type === 'input_json_delta') {
        const block = blocks.get(index);
        if (block?.kind === 'tool') block.json += delta.partial_json ?? '';
      }
      continue;
    }
    if (type === 'message_delta') {
      const usage = data.usage as { output_tokens?: number } | undefined;
      if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens;
    }
  }

  const toolCalls: ToolCall[] = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, block]) => {
      if (block.kind !== 'tool') return [];
      const args = block.json.trim()
        ? safeJsonParse<Record<string, unknown>>(block.json, block.initial)
        : block.initial;
      return [{ id: block.id, name: names.fromWire(block.name), args }];
    });
  const usage = { inputTokens, outputTokens };
  return {
    text,
    thinking: thinkingText,
    thinkingSignature,
    toolCalls,
    usage,
    provider: 'anthropic',
    model,
    costUsd: estimateCost(ctx.model, usage),
  };
}
