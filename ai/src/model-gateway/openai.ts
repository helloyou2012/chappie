/**
 * OpenAI 协议适配（两种）：
 *   1. Chat Completions —— POST {base}/chat/completions（兼容绝大多数 OpenAI 风格网关）
 *   2. Responses —— POST {base}/responses（OpenAI 新一代接口）
 * baseUrl 形如 https://api.openai.com/v1
 */

import type { ChatMessage, CompleteRequest, Provider, ToolCall } from './types';
import { estimateCost, safeJsonParse } from './types';

// ---------------------------------------------------------------------------
// Chat Completions
// ---------------------------------------------------------------------------

function toChatMessage(m: ChatMessage): Record<string, unknown> {
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
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

export const openaiChatProvider: Provider = {
  name: 'openai-chat',
  async complete(req: CompleteRequest, ctx) {
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages.map(toChatMessage)],
      temperature: req.temperature ?? 0.6,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
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
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = data.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: safeJsonParse<Record<string, unknown>>(tc.function.arguments, {}),
    }));
    const usage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
    return {
      text: msg.content ?? '',
      toolCalls,
      usage,
      provider: 'openai-chat',
      model: data.model ?? ctx.model,
      costUsd: estimateCost(ctx.model, usage),
    };
  },
};

// ---------------------------------------------------------------------------
// Responses API
// ---------------------------------------------------------------------------

type ResponsesInputItem =
  | { role: 'user' | 'assistant'; content: { type: 'input_text' | 'output_text'; text: string }[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

function toResponsesInput(m: ChatMessage): ResponsesInputItem[] {
  if (m.role === 'tool') {
    return [{ type: 'function_call_output', call_id: m.toolCallId ?? '', output: m.content }];
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return m.toolCalls.map((tc) => ({
      type: 'function_call' as const,
      call_id: tc.id,
      name: tc.name,
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
    const body: Record<string, unknown> = {
      model: ctx.model,
      instructions: req.system,
      input: req.messages.flatMap(toResponsesInput),
      temperature: req.temperature ?? 0.6,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        name: t.name,
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
          name: item.name,
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
