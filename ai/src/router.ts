/**
 * 触发路由：一条消息涉及哪些分身 —— 设计方案 §4.4 第 1 步、§27.3 第 2 步。
 *
 * 规则：
 *   - 系统会话（avatar_self）：主人的 human 消息 = 直接对分身下达指令（等同 @）；
 *     分身自己发出的卡片/消息不触发。
 *   - 普通会话：被 @ 的 avatar 总是候选（包括主人 @ 自己的分身）；人类消息还会触发
 *     「对方/其他成员」的分身（via direct/auto，最终由策略引擎按档位过滤）。
 *     发送者自己的分身只有在被显式 @ 时才响应，不参与自动候选。
 *   - 发送者是 avatar（AI 对 AI）：仅被 @ 的分身响应，其余交给 hop_count 强校验
 *     （设计方案 §29.6 防互聊死循环）。
 */

import type { Message } from '@chappie/contract';
import type { EngagementContext } from './engagement';

export interface MemberSnapshot {
  principalId: string;
  principalType: string;
  ownerId: string | null;
}

export interface Candidate {
  avatarId: string;
  ownerId: string;
  mentioned: boolean;
  via: 'mention' | 'reply' | 'continuation' | 'direct' | 'auto' | 'self_chat';
}

export function findCandidates(
  message: Message,
  members: MemberSnapshot[],
  conv: { id: string; type: string; systemTag: string | null },
  engagement?: EngagementContext,
): Candidate[] {
  const mentionSet = new Set(message.mentions);
  const avatars = members.filter((m) => m.principalType === 'avatar' && m.ownerId);
  const ownerOfSender = members.find((m) => m.principalId === message.senderId)?.ownerId ?? null;

  // 系统会话：主人 ↔ 自己的分身
  if (conv.systemTag === 'avatar_self') {
    if (message.senderType !== 'human') return [];
    const own = avatars.find((a) => a.ownerId === message.senderId);
    return own
      ? [{ avatarId: own.principalId, ownerId: own.ownerId!, mentioned: true, via: 'self_chat' }]
      : [];
  }

  const byId = new Map<string, Candidate>();
  // 触发来源优先级：显式提及 > 回复分身 > 会话延续 > 私聊/自动
  const VIA_RANK: Record<Candidate['via'], number> = {
    mention: 5,
    reply: 4,
    continuation: 3,
    direct: 2,
    auto: 1,
    self_chat: 0,
  };
  const add = (a: { principalId: string; ownerId: string | null }, via: Candidate['via']) => {
    if (!a.ownerId) return;
    if (a.principalId === message.senderId) return;
    if (byId.has(a.principalId)) {
      const existing = byId.get(a.principalId)!;
      if (via === 'mention') existing.mentioned = true;
      if (VIA_RANK[via] > VIA_RANK[existing.via]) existing.via = via;
      return;
    }
    byId.set(a.principalId, {
      avatarId: a.principalId,
      ownerId: a.ownerId,
      mentioned: mentionSet.has(a.principalId),
      via,
    });
  };

  // 被 @ 的分身：显式提及一律作为候选。
  // 主人 @ 自己的分身仅在群聊中生效（等同「让分身代我回答」）；
  // 私聊里对方分身已被 direct 规则触发，再唤醒自己的分身会双份回复。
  for (const a of avatars) {
    if (!mentionSet.has(a.principalId)) continue;
    if (message.senderType === 'human' && a.ownerId === message.senderId && conv.type !== 'group') {
      continue;
    }
    add(a, 'mention');
  }

  // 显式 @ 是排他寻址：人类消息一旦带 mention，只允许被 @ 的分身响应，
  // 不再叠加 direct / auto / reply / continuation，避免“@ 了甲，乙的分身也插话”。
  if (message.senderType === 'human' && message.mentions.length > 0) {
    return [...byId.values()];
  }

  if (message.senderType === 'human') {
    // 人类消息：其他成员的 human 各自的分身作为候选（direct=1v1 对话方，auto=群内）
    const otherHumanOwners = new Set(
      members
        .filter((m) => m.principalType === 'human' && m.principalId !== message.senderId)
        .map((m) => m.principalId),
    );
    for (const ownerId of otherHumanOwners) {
      const a = avatars.find((x) => x.ownerId === ownerId);
      if (a) add(a, conv.type === 'direct' ? 'direct' : 'auto');
    }
  } else if (message.senderType === 'avatar' && ownerOfSender) {
    // AI 对 AI：除被 @ 外，只有「对话另一方的分身」可以响应（避免群内多分身乱入）
    if (conv.type === 'direct') {
      const others = avatars.filter((a) => a.ownerId !== ownerOfSender);
      for (const a of others) add(a, 'direct');
    }
  }

  // 会话延续（P1）：回复分身消息 / 被 @ 后同一发送者的后续消息
  if (message.senderType === 'human') {
    if (engagement?.replyToAvatarId) {
      const avatar = avatars.find((a) => a.principalId === engagement.replyToAvatarId);
      if (avatar) add(avatar, 'reply');
    }
    for (const id of engagement?.continuationAvatarIds ?? []) {
      const avatar = avatars.find((a) => a.principalId === id);
      if (avatar) add(avatar, 'continuation');
    }
  }

  return [...byId.values()];
}
