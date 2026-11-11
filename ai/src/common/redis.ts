/**
 * Redis 加速层（ai: 命名空间，全部带 TTL —— 设计方案 §37）。
 * 语料：策略缓存、去重窗口、冷却、并发信号量、LLM 缓存。
 * 注意：事实数据（任务/审批/记忆）一律存 PG，不依赖本层。
 */

import { RedisClient } from 'bun';
import { config } from './config';

export const redis = new RedisClient(config.redisUrl);

export async function redisGet(key: string): Promise<string | null> {
  try {
    const v = await redis.send('GET', [key]);
    return typeof v === 'string' ? v : v == null ? null : String(v);
  } catch {
    return null; // 加速层失败按未命中处理
  }
}

export async function redisSetEx(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await redis.send('SET', [key, value, 'EX', String(ttlSeconds)]);
  } catch {
    /* 降级：仅多花成本 */
  }
}

export async function redisDel(key: string): Promise<void> {
  try {
    await redis.send('DEL', [key]);
  } catch {
    /* ignore */
  }
}

/** 窗口计数：INCR + 首次设置 TTL，返回当前计数（Redis 不可用时返回 0，调用方按放行处理） */
export async function redisIncrWindow(key: string, ttlSeconds: number): Promise<number> {
  try {
    const n = await redis.send('INCR', [key]);
    const count = Number(n);
    if (count === 1) await redis.send('EXPIRE', [key, String(ttlSeconds)]);
    return count;
  } catch {
    return 0;
  }
}

export async function redisExists(key: string): Promise<boolean> {
  try {
    return Number(await redis.send('EXISTS', [key])) > 0;
  } catch {
    return false;
  }
}

/** SET NX（去重窗口），返回是否首次写入 */
export async function redisSetNx(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const r = await redis.send('SET', [key, '1', 'NX', 'EX', String(ttlSeconds)]);
    return r === 'OK';
  } catch {
    return true; // 不可用时放行，PG 唯一键兜底
  }
}

/** 分布式信号量（ZSet 计数，任务超时清理 —— 设计方案 §37.1） */
export async function redisSemaphoreAcquire(
  key: string,
  limit: number,
  ttlSeconds: number,
): Promise<boolean> {
  try {
    const n = await redis.send('INCR', [key]);
    if (Number(n) === 1) await redis.send('EXPIRE', [key, String(ttlSeconds)]);
    if (Number(n) > limit) {
      await redis.send('DECR', [key]);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export async function redisSemaphoreRelease(key: string): Promise<void> {
  try {
    await redis.send('DECR', [key]);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// ai: key 约定（设计方案 §37.1）
// ---------------------------------------------------------------------------

export const aiKeys = {
  policy: (avatarId: string) => `ai:policy:${avatarId}`,
  dedup: (msgId: string, avatarId: string) => `ai:dedup:${msgId}:${avatarId}`,
  cooldown: (convId: string, ownerId: string) => `ai:cooldown:${convId}:${ownerId}`,
  rate: (avatarId: string) => `ai:rl:${avatarId}`,
  semModel: (provider: string) => `ai:sem:model:${provider}`,
  semAvatar: (avatarId: string) => `ai:sem:avatar:${avatarId}`,
  llmCache: (hash: string) => `ai:llmcache:${hash}`,
  budgetNotified: (avatarId: string, day: string) => `ai:budget-notified:${avatarId}:${day}`,
};
