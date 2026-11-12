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
  /** 任务租约 TTL（秒）：心跳间隔续约，过期即可被恢复清扫认领 */
  taskLeaseTtlSeconds: number;
  /** 任务心跳间隔（毫秒） */
  taskHeartbeatMs: number;
  /** 恢复时效线（秒）：超过即视为过期任务直接丢弃（设计方案 §26.3） */
  recoveryStaleSeconds: number;
  /** created 状态孤儿认领宽限（秒）：覆盖存量僵尸行（lease 为 NULL） */
  recoveryCreatedGraceSeconds: number;
  /** 已决议审批续跑中断的认领宽限（秒）：避免与刚批准的正常续跑竞争 */
  recoveryApprovalGraceSeconds: number;
  /** 恢复清扫每 tick 认领上限 */
  recoveryBatch: number;
  /** 提示词历史区字符预算（有界上下文） */
  contextCharBudget: number;
  /** 合理沉默阈值：低于该置信度且满足其他条件时沉默；0 = 关闭 */
  silenceMinConfidence: number;
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
    taskLeaseTtlSeconds: Number(env('AI_TASK_LEASE_TTL_S', '120')),
    taskHeartbeatMs: Number(env('AI_TASK_HEARTBEAT_MS', '30000')),
    recoveryStaleSeconds: Number(env('AI_RECOVERY_STALE_S', '3600')),
    recoveryCreatedGraceSeconds: Number(env('AI_RECOVERY_CREATED_GRACE_S', '600')),
    recoveryApprovalGraceSeconds: Number(env('AI_RECOVERY_APPROVAL_GRACE_S', '120')),
    recoveryBatch: Number(env('AI_RECOVERY_BATCH', '5')),
    contextCharBudget: Number(env('AI_CONTEXT_CHAR_BUDGET', '6000')),
    silenceMinConfidence: Number(env('AI_SILENCE_MIN_CONFIDENCE', '0.6')),
  };
}

export const config = loadConfig();
