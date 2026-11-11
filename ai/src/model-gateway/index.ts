/**
 * 模型网关入口：provider 路由 + 重试 + 降级 mock + 用量记账。
 * 业务代码只调用 complete()，换供应商/模型不改业务（设计方案 §27.8）。
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { and, eq, sql } from 'drizzle-orm';
import { config } from '../common/config';
import { dayjs } from '../common/datetime';
import { db } from '../common/db';
import { log } from '../common/log';
import { usageDaily } from '../db/schema';
import { anthropicProvider } from './anthropic';
import { mockProvider } from './mock';
import { openaiChatProvider, openaiResponsesProvider } from './openai';
import type { CompleteRequest, CompleteResult, Provider } from './types';

export * from './types';

const providers: Record<string, Provider> = {
  mock: mockProvider,
  'openai-chat': openaiChatProvider,
  'openai-responses': openaiResponsesProvider,
  anthropic: anthropicProvider,
};

export interface ModelOverride {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export async function complete(
  req: CompleteRequest,
  override?: ModelOverride,
): Promise<CompleteResult> {
  const providerName = override?.provider || config.modelProvider;
  const provider = providers[providerName] ?? mockProvider;
  const ctx = {
    model: override?.model || config.modelName,
    baseUrl: override?.baseUrl || config.modelBaseUrl,
    apiKey: override?.apiKey || config.modelApiKey,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await provider.complete(req, ctx);
    } catch (e) {
      lastError = e;
      log.warn('model call failed', { provider: provider.name, attempt, error: String(e) });
      if (attempt < 3) await sleep(300 * 2 ** (attempt - 1));
    }
  }

  // 降级：模型供应商故障不影响聊天（设计方案 §23 边界约定 6）
  if (provider.name !== 'mock') {
    log.warn('fallback to mock provider', { provider: provider.name, error: String(lastError) });
    return mockProvider.complete(req, { ...ctx, model: 'mock-1' });
  }
  throw lastError;
}

/** 记录用量（按 avatar 归因 —— 设计方案 §27.8 成本归因） */
export async function recordUsage(avatarId: string, result: CompleteResult): Promise<void> {
  if (result.usage.inputTokens === 0 && result.usage.outputTokens === 0) return;
  const today = dayjs.utc().format('YYYY-MM-DD');
  await db
    .insert(usageDaily)
    .values({
      avatarId,
      day: today,
      provider: result.provider,
      model: result.model,
      requests: 1,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: String(result.costUsd),
    })
    .onConflictDoUpdate({
      target: [usageDaily.avatarId, usageDaily.day, usageDaily.provider, usageDaily.model],
      set: {
        requests: sql`${usageDaily.requests} + 1`,
        inputTokens: sql`${usageDaily.inputTokens} + excluded.input_tokens`,
        outputTokens: sql`${usageDaily.outputTokens} + excluded.output_tokens`,
        costUsd: sql`${usageDaily.costUsd} + excluded.cost_usd`,
        updatedAt: sql`now()`,
      },
    });
}

/** 当日已花费（预算控制用） */
export async function todayCost(avatarId: string): Promise<number> {
  const rows = await db
    .select({ cost: sql<number>`COALESCE(SUM(${usageDaily.costUsd}), 0)::float8` })
    .from(usageDaily)
    .where(and(eq(usageDaily.avatarId, avatarId), sql`${usageDaily.day} = CURRENT_DATE`));
  return Number(rows[0]?.cost ?? 0);
}

export { providers };
