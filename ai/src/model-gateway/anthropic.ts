/**
 * Anthropic Messages API 适配 —— POST {base}/v1/messages（baseUrl 形如 https://api.anthropic.com）。
 * system 独立字段；tool_use / tool_result 内容块。
 */

import type { ChatMessage, CompleteRequest, Provider, ToolCall } from './types';
import { estimateCost } from './types';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicBlock[] };

function toAnthropicMessage(m: ChatMessage): AnthropicMessage {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }],
    };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    const blocks: AnthropicBlock[] = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const tc of m.toolCalls) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
    }
    return { role: 'assistant', content: blocks };
  }
  return { role: m.role, content: m.content };
}

export const anthropicProvider: Provider = {
  name: 'anthropic',
  async complete(req: CompleteRequest, ctx) {
    const body: Record<string, unknown> = {
      model: ctx.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: req.messages.map(toAnthropicMessage),
      temperature: req.temperature ?? 0.6,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
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
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      )[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, args: block.input });
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
      provider: 'anthropic',
      model: data.model ?? ctx.model,
      costUsd: estimateCost(ctx.model, usage),
    };
  },
};
