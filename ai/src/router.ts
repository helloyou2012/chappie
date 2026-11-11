/**
 * 触发路由：一条消息涉及哪些分身 —— 设计方案 §4.4 第 1 步、§27.3 第 2 步。
 *
 * 规则：
 *   - 系统会话（avatar_self）：主人的 human 消息 = 直接对分身下达指令（等同 @）；
 *     分身自己发出的卡片/消息不触发。
 *   - 普通会话：被 @ 的 avatar 总是候选；人类消息还会触发「对方/其他成员」的
 *     分身（via direct/auto，最终由策略引擎按档位过滤）；发送者自己的分身除外。
 *   - 发送者是 avatar（AI 对 AI）：仅被 @ 的分身响应，其余交给 hop_count 强校验
 *     （设计方案 §29.6 防互聊死循环）。
 */

import type { Message } from '@chappie/contract';

export interface MemberSnapshot {
  principalId: string;
  principalType: string;
  ownerId: string | null;
}

export interface Candidate {
  avatarId: string;
  ownerId: string;
  mentioned: boolean;
  via: 'mention' | 'direct' | 'auto' | 'self_chat';
}

export function findCandidates(
  message: Message,
  members: MemberSnapshot[],
  conv: { id: string; type: string; systemTag: string | null },
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
  const add = (a: { principalId: string; ownerId: string | null }, via: Candidate['via']) => {
    if (!a.ownerId) return;
    if (a.principalId === message.senderId) return;
    if (byId.has(a.principalId)) {
      const existing = byId.get(a.principalId)!;
      if (via === 'mention') existing.mentioned = true;
      return;
    }
    byId.set(a.principalId, {
      avatarId: a.principalId,
      ownerId: a.ownerId,
      mentioned: mentionSet.has(a.principalId),
      via,
    });
  };

  // 被 @ 的分身（含他人 @ 你的分身 —— 是否允许由策略/能力风险决定）
  for (const a of avatars) {
    if (mentionSet.has(a.principalId)) {
      // 排除发送者自己的分身被 @（自己 @ 自己分身无意义，但保留给 self_chat 场景）
      if (message.senderType === 'human' && a.ownerId === message.senderId) continue;
      add(a, 'mention');
    }
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

  return [...byId.values()];
}
