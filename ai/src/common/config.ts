/**
 * ai-platform 配置（根目录 .env，经 `bun --env-file=../.env` 加载）。
 */

export interface AiConfig {
  databaseUrl: string;
  redisUrl: string;
  internalToken: string;
  /** Rust 内部 API 基址 */
  internalBaseUrl: string;
  adminPort: number;
  modelProvider: 'mock' | 'openai-chat' | 'openai-responses' | 'anthropic';
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  /** 分类小模型（缺省回退主模型） */
  classifierProvider: string;
  classifierBaseUrl: string;
  classifierApiKey: string;
  classifierModel: string;
  avatarDailyBudgetUsd: number;
  maxHopCount: number;
}

function env(key: string, def = ''): string {
  return process.env[key] ?? def;
}

export function loadConfig(): AiConfig {
  const provider = (env('MODEL_PROVIDER', 'mock') || 'mock').toLowerCase();
  const apiKey = env('MODEL_API_KEY');
  return {
    databaseUrl: env('DATABASE_URL', 'postgres://chappie:chappie@127.0.0.1:5432/chappie'),
    redisUrl: env('REDIS_URL', 'redis://127.0.0.1:6379'),
    internalToken: env('INTERNAL_TOKEN', 'dev-internal-token-change-me'),
    internalBaseUrl: env('INTERNAL_BASE_URL', 'http://127.0.0.1:7001'),
    adminPort: Number(env('ADMIN_PORT', '7002')),
    // 未配置 key 时一律降级 mock（开箱即跑）
    modelProvider: apiKey || provider === 'mock' ? (provider as AiConfig['modelProvider']) : 'mock',
    modelBaseUrl: env('MODEL_BASE_URL', 'https://api.openai.com/v1'),
    modelApiKey: apiKey,
    modelName: env('MODEL_NAME', 'gpt-4o-mini'),
    classifierProvider: env('CLASSIFIER_PROVIDER'),
    classifierBaseUrl: env('CLASSIFIER_BASE_URL'),
    classifierApiKey: env('CLASSIFIER_API_KEY'),
    classifierModel: env('CLASSIFIER_MODEL'),
    avatarDailyBudgetUsd: Number(env('AVATAR_DAILY_BUDGET_USD', '1.0')),
    maxHopCount: Number(env('MAX_HOP_COUNT', '3')),
  };
}

export const config = loadConfig();
