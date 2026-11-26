/**
 * 本地 mmBERT reply/silent 决策服务客户端。
 * 输入是 reply-context.ts 序列化后的“观察者视角”上下文；只给 auto/direct 候选使用。
 */
import type { Classification } from './classifier';
import { config } from './common/config';
import { log } from './common/log';

export interface ReplyDecision {
  label: string;
  needReply: boolean;
  confidence: number;
}

const cache = new Map<string, { value: ReplyDecision; at: number }>();
const rankCache = new Map<string, { scores: number[]; probs: number[]; at: number }>();
const CACHE_TTL_MS = 5 * 60_000;
let failures = 0;
let disabledUntil = 0;

function noteFailure(): void {
  failures += 1;
  if (failures >= 3) {
    disabledUntil = Date.now() + 30_000;
    failures = 0;
  }
}

function parse(value: unknown): ReplyDecision | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.needReply !== 'boolean') return null;
  const confidence = typeof v.confidence === 'number' ? v.confidence : Number(v.confidence);
  if (!Number.isFinite(confidence)) return null;
  return {
    label: typeof v.label === 'string' ? v.label : v.needReply ? 'reply' : 'silent',
    needReply: v.needReply,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

export interface RankResult {
  scores: number[];
  probs: number[];
}

/** Pairwise：一次提交同一消息下的所有候选上下文，返回 reply logit / 概率 */
export async function rankReplies(texts: string[]): Promise<RankResult | null> {
  if (!config.classifierBaseUrl || config.classifierTimeoutMs <= 0 || texts.length === 0)
    return null;
  if (Date.now() < disabledUntil) return null;
  const key = texts.join('\n---\n').slice(0, 20000);
  const hit = rankCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.classifierTimeoutMs);
  try {
    const res = await fetch(`${config.classifierBaseUrl.replace(/\/$/, '')}/rank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });
    if (!res.ok) {
      noteFailure();
      return null;
    }
    const data = (await res.json()) as { scores?: unknown; probs?: unknown };
    const scores = Array.isArray(data.scores) ? data.scores.map(Number) : [];
    const probs = Array.isArray(data.probs) ? data.probs.map(Number) : [];
    if (scores.length !== texts.length || probs.length !== texts.length) {
      noteFailure();
      return null;
    }
    if (scores.some((v) => !Number.isFinite(v)) || probs.some((v) => !Number.isFinite(v))) {
      noteFailure();
      return null;
    }
    failures = 0;
    if (rankCache.size > 500) rankCache.clear();
    const value = { scores, probs };
    rankCache.set(key, { ...value, at: Date.now() });
    return value;
  } catch (e) {
    noteFailure();
    log.debug('pairwise classifier unavailable', { error: String(e).slice(0, 120) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function decideReply(text: string): Promise<ReplyDecision | null> {
  if (!config.classifierBaseUrl || config.classifierTimeoutMs <= 0) return null;
  if (Date.now() < disabledUntil) return null;
  const key = text.slice(0, 4000);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.classifierTimeoutMs);
  try {
    const res = await fetch(`${config.classifierBaseUrl.replace(/\/$/, '')}/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: key }),
      signal: controller.signal,
    });
    if (!res.ok) {
      noteFailure();
      return null;
    }
    const decision = parse(await res.json());
    if (!decision) {
      noteFailure();
      return null;
    }
    failures = 0;
    if (cache.size > 2000) cache.clear();
    cache.set(key, { value: decision, at: Date.now() });
    return decision;
  } catch (e) {
    noteFailure();
    log.debug('reply classifier unavailable', { error: String(e).slice(0, 120) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 模型只覆盖 needReply；风险/紧急/话题仍由规则兜底 */
export function applyReplyDecision(
  rules: Classification,
  decision: ReplyDecision | null,
): Classification {
  if (!decision || decision.confidence < 0.6) return rules;
  const mustReply =
    rules.topics.length > 0 || rules.urgency === 'high' || rules.sentiment === 'angry';
  return {
    ...rules,
    needReply: mustReply ? true : decision.needReply,
    confidence: decision.confidence,
    summary: `${rules.summary} | mmbert=${decision.label}:${decision.confidence.toFixed(2)}`,
  };
}
