/**
 * 记忆服务 —— 设计方案 §9：
 *   分层：事实/偏好（语义）、承诺/事件（情景）、关系、程序；
 *   治理：来源/敏感级/置信度/TTL；按对话对象做访问控制（跨联系人隔离）；
 *   敏感类默认不可用于对外对话。
 *
 * 向量：hashEmbedding 生成 256 维伪向量（REAL[] 列），检索时应用层余弦 +
 * 关键词命中。真实语义检索可无缝替换为 pgvector/embedding API（接口已隔离）。
 */

import type { MemoryItem, Message } from '@chappie/contract';
import { and, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { newId } from './common/log';
import { memoryItem } from './db/schema';

const EMBED_DIM = 256;

/** 哈希伪向量：字符 bigram 散列到 256 维并归一化 */
export function hashEmbedding(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  const clean = text.toLowerCase().replace(/[\s，。！？、；：""''（）()【】[\]!?.,;:]/g, ' ');
  const tokens = clean.split(/\s+/).filter(Boolean);
  const grams: string[] = [];
  for (const t of tokens) {
    if (t.length === 1) grams.push(t);
    for (let i = 0; i + 1 < t.length; i++) grams.push(t.slice(i, i + 2));
  }
  for (const g of grams) {
    let h = 2166136261;
    for (let i = 0; i < g.length; i++) {
      h ^= g.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBED_DIM;
    v[idx] += h % 2 === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Math.round((x / norm) * 1e4) / 1e4);
}

function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** 关键词抽取（供检索与展示） */
export function extractKeywords(text: string): string[] {
  const stop = new Set([
    '的',
    '了',
    '是',
    '我',
    '你',
    '他',
    '她',
    '它',
    '在',
    '有',
    '和',
    '就',
    '都',
    '也',
    '很',
    '吧',
    '吗',
    '呢',
    '啊',
    '哦',
    '嗯',
  ]);
  const words = text
    .split(/[\s，。！？、；：""''（）()【】[\]!?.,;:]+/)
    .flatMap((w) => (w.length > 4 ? [w.slice(0, 4), w.slice(4)] : [w]))
    .filter((w) => w.length >= 2 && !stop.has(w));
  return [...new Set(words)].slice(0, 8);
}

// ---------------------------------------------------------------------------
// 写入：规则抽取（真实模型可替换为 LLM 抽取，接口不变）
// ---------------------------------------------------------------------------

export interface ExtractedMemory {
  type: 'fact' | 'preference' | 'commitment' | 'episode' | 'relationship' | 'procedure';
  scope: 'global' | 'contact';
  peerId: string | null;
  content: string;
  sensitivity: 'normal' | 'sensitive';
  confidence: number;
}

export function extractFromMessages(
  messages: Message[],
  ownerId: string,
  peerId: string | null,
): ExtractedMemory[] {
  const out: ExtractedMemory[] = [];
  for (const m of messages) {
    if (m.senderId !== ownerId || m.content.type !== 'text') continue;
    const text = m.content.text;

    for (const match of text.matchAll(/我叫([^\s，。！？、]{1,10})/g)) {
      out.push({
        type: 'fact',
        scope: 'global',
        peerId: null,
        content: `名字：${match[1]}`,
        sensitivity: 'normal',
        confidence: 0.9,
      });
    }
    for (const match of text.matchAll(/我(?:喜欢|偏好|爱喝|爱吃|习惯)([^，。！？]{1,24})/g)) {
      out.push({
        type: 'preference',
        scope: 'global',
        peerId: null,
        content: `偏好：${match[1]}`,
        sensitivity: 'normal',
        confidence: 0.8,
      });
    }
    for (const match of text.matchAll(
      /((?:明天|后天|下周|周[一二三四五六日]|这周)[^。！？]{0,24}(?:答应|会|给你|发给|回复|安排|带)[^。！？]{0,24})/g,
    )) {
      out.push({
        type: 'commitment',
        scope: 'contact',
        peerId,
        content: `承诺：${match[1].trim()}`,
        sensitivity: 'normal',
        confidence: 0.75,
      });
    }
    if (/密码|身份证|银行卡|病历|诊断|工资|存款/.test(text)) {
      out.push({
        type: 'fact',
        scope: 'contact',
        peerId,
        content: `敏感信息：${text.slice(0, 40)}`,
        sensitivity: 'sensitive',
        confidence: 0.6,
      });
    }
  }
  // 去重（同内容保留最高置信度）
  const seen = new Map<string, ExtractedMemory>();
  for (const m of out) {
    const key = `${m.scope}:${m.type}:${m.content}`;
    const prev = seen.get(key);
    if (!prev || prev.confidence < m.confidence) seen.set(key, m);
  }
  return [...seen.values()];
}

export async function saveMemories(
  avatarId: string,
  items: ExtractedMemory[],
  sourceMsgId?: string | null,
): Promise<number> {
  let saved = 0;
  for (const item of items) {
    const existing = await db
      .select({ id: memoryItem.id })
      .from(memoryItem)
      .where(and(eq(memoryItem.avatarId, avatarId), eq(memoryItem.content, item.content)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(memoryItem).values({
      id: newId('mem'),
      avatarId,
      scope: item.scope,
      peerId: item.peerId,
      type: item.type,
      content: item.content,
      embedding: hashEmbedding(item.content),
      keywords: extractKeywords(item.content),
      sensitivity: item.sensitivity,
      confidence: item.confidence,
      sourceMsgId: sourceMsgId ?? null,
    });
    saved++;
  }
  return saved;
}

// ---------------------------------------------------------------------------
// 检索：对象可见性 + 敏感过滤 + 关键词/向量混合排序
// ---------------------------------------------------------------------------

export interface RetrievedMemory {
  id: string;
  type: string;
  content: string;
  confidence: number;
  sensitivity: string;
  createdAt: string;
  score: number;
}

export async function retrieveMemories(params: {
  avatarId: string;
  peerId: string | null;
  query: string;
  /** 对外对话时排除敏感记忆（设计方案 §9.2） */
  forExternal: boolean;
  limit?: number;
}): Promise<RetrievedMemory[]> {
  const limit = params.limit ?? 5;
  const scopeFilter = or(
    eq(memoryItem.scope, 'global'),
    and(
      eq(memoryItem.scope, 'contact'),
      params.peerId === null ? sql`false` : eq(memoryItem.peerId, params.peerId),
    ),
  );
  const rows = await db
    .select({
      id: memoryItem.id,
      type: memoryItem.type,
      content: memoryItem.content,
      embedding: memoryItem.embedding,
      keywords: memoryItem.keywords,
      sensitivity: memoryItem.sensitivity,
      confidence: memoryItem.confidence,
      createdAt: memoryItem.createdAt,
    })
    .from(memoryItem)
    .where(
      and(
        eq(memoryItem.avatarId, params.avatarId),
        scopeFilter,
        or(isNull(memoryItem.expiresAt), gt(memoryItem.expiresAt, sql`now()`)),
        params.forExternal ? eq(memoryItem.sensitivity, 'normal') : sql`true`,
      ),
    )
    .orderBy(desc(memoryItem.createdAt))
    .limit(200);

  if (rows.length === 0) return [];

  const queryTokens = extractKeywords(params.query);
  const queryVec = hashEmbedding(params.query);
  const now = dayjs();

  const scored = rows.map((r) => {
    const kwHits = (r.keywords ?? []).filter((k) =>
      queryTokens.some((t) => k.includes(t) || t.includes(k)),
    ).length;
    const vec = cosine(queryVec, r.embedding ?? []);
    const ageDays = now.diff(dayjs(r.createdAt), 'day', true);
    const recency = Math.max(0, 1 - ageDays / 90);
    const score = kwHits * 0.5 + vec * 0.3 + recency * 0.1 + Number(r.confidence) * 0.1;
    return {
      id: r.id,
      type: r.type,
      content: r.content,
      confidence: Number(r.confidence),
      sensitivity: r.sensitivity,
      createdAt: dayjs(r.createdAt).toISOString(),
      score,
    };
  });

  return scored
    .filter((s) => s.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// 治理（控制台）
// ---------------------------------------------------------------------------

export async function listMemories(
  avatarId: string,
  scope: 'all' | 'global' | 'contact',
  peerId?: string,
): Promise<MemoryItem[]> {
  const rows = await db
    .select({
      id: memoryItem.id,
      avatarId: memoryItem.avatarId,
      scope: memoryItem.scope,
      peerId: memoryItem.peerId,
      type: memoryItem.type,
      content: memoryItem.content,
      keywords: memoryItem.keywords,
      sensitivity: memoryItem.sensitivity,
      confidence: memoryItem.confidence,
      sourceMsgId: memoryItem.sourceMsgId,
      expiresAt: memoryItem.expiresAt,
      createdAt: memoryItem.createdAt,
    })
    .from(memoryItem)
    .where(
      and(
        eq(memoryItem.avatarId, avatarId),
        scope === 'all' ? sql`true` : eq(memoryItem.scope, scope),
        peerId ? eq(memoryItem.peerId, peerId) : sql`true`,
      ),
    )
    .orderBy(desc(memoryItem.createdAt))
    .limit(200);
  return rows.map((r) => ({
    ...r,
    expiresAt: r.expiresAt ? dayjs(r.expiresAt).toISOString() : null,
    createdAt: dayjs(r.createdAt).toISOString(),
  }));
}

/** ownerId 由调用方（admin-api）预先校验：avatarId 属于该主人 */
export async function deleteMemory(
  avatarId: string,
  memoryId: string,
  _ownerId: string,
): Promise<boolean> {
  const rows = await db
    .delete(memoryItem)
    .where(and(eq(memoryItem.id, memoryId), eq(memoryItem.avatarId, avatarId)))
    .returning({ id: memoryItem.id });
  return rows.length > 0;
}

export async function forgetTopic(avatarId: string, keyword: string): Promise<number> {
  const rows = await db
    .delete(memoryItem)
    .where(and(eq(memoryItem.avatarId, avatarId), ilike(memoryItem.content, `%${keyword}%`)))
    .returning({ id: memoryItem.id });
  return rows.length;
}
