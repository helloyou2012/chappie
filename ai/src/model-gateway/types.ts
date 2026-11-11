/**
 * 模型网关统一接口 —— 设计方案 §27.8：
 * 业务代码只依赖 CompleteRequest/CompleteResult，供应商差异在 provider 内部消化。
 * 支持四种 provider：mock（默认降级）/ openai-chat / openai-responses / anthropic。
 */

import { parseJsonSafe } from '../common/json';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** role=tool 时：对应的工具调用 id */
  toolCallId?: string;
  /** role=assistant 时：发起的工具调用 */
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
}

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  /** Mock provider 专用提示（真实 provider 忽略） */
  mockHints?: {
    ownerName?: string;
    persona?: string;
    intent?: string;
    /** 触发消息原文（关键词规则只应作用于它，而不是整段历史） */
    triggerText?: string;
  };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  provider: string;
  model: string;
  costUsd: number;
  /** 建议转人工的原因（mock 依据内容风险判定；真实模型由护栏/策略补充） */
  handover?: string;
  /** 决策置信度（mock 模拟；真实模型默认 0.8，由护栏调整） */
  confidence?: number;
}

export interface ProviderContext {
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface Provider {
  name: string;
  complete(req: CompleteRequest, ctx: ProviderContext): Promise<CompleteResult>;
}

// 演示用价格表（USD / token）。生产应来自配置中心（设计方案 §27.8）。
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15 / 1e6, output: 0.6 / 1e6 },
  'gpt-4o': { input: 2.5 / 1e6, output: 10 / 1e6 },
  'gpt-4.1-mini': { input: 0.4 / 1e6, output: 1.6 / 1e6 },
  'claude-sonnet-5-5': { input: 3 / 1e6, output: 15 / 1e6 },
  'claude-haiku-5-5': { input: 1 / 1e6, output: 5 / 1e6 },
  'claude-fable-5-1': { input: 3 / 1e6, output: 15 / 1e6 },
};

export function estimateCost(model: string, usage: Usage): number {
  const p = PRICING[model] ??
    Object.entries(PRICING).find(([k]) => model.startsWith(k))?.[1] ?? {
      input: 1 / 1e6,
      output: 4 / 1e6,
    };
  return usage.inputTokens * p.input + usage.outputTokens * p.output;
}

/** 模型输出容错解析：参数可能不完整（截断），partial-json 可恢复出已有字段 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  return parseJsonSafe<T>(raw) ?? fallback;
}
