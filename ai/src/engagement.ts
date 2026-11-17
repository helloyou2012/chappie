/**
 * 会话延续（P1，确定性规则，不做语义判断）。
 *
 * 触发：
 *   - 回复链：当前消息 replyTo 指向某条分身消息 → 视作对该分身的直接对话；
 *   - 会话窗口：同一发送者在最近 10 分钟内 @ 过/回复过分身，且此后没有其他真人插话，
 *     则其后续消息继续视为与该分身的对话（最多 5 次分身回复）。
 *
 * 结束：
 *   - 其他真人插话、当前消息 @ 了别的分身、超过时间窗、达到回复轮次上限；
 *   - 纯寒暄/确认（“好的”“嗯”等）不触发延续，避免刷屏。
 */

import type { MemberSnapshot } from './router';

export interface EngagementMessage {
  msgId: string;
  senderId: string;
  senderType: string;
  mentions: string[];
  replyTo: string | null;
  createdAt: Date;
  text?: string;
}

export interface ReplyTarget {
  senderId: string;
  senderType: string;
}

export interface EngagementContext {
  /** 当前消息回复的分身（强触发，视同 @） */
  replyToAvatarId: string | null;
  /** 仍在会话窗口内、可继续响应的分身 */
  continuationAvatarIds: string[];
}

export const CONTINUATION_WINDOW_MS = 10 * 60 * 1000;
const MAX_AVATAR_REPLIES = 5;

/** 纯寒暄/确认不开启延续，避免窗口内每句话都触发分身。 */
export function isContinuationWorthy(text: string | undefined): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  if (value.length > 60) return true;
  return !/^(好|好的|好滴|嗯+|哦+|噢+|哈+|呵+|收到|谢谢|多谢|ok|okay|行|可以|对|是|了解|明白|知道了|👌|👍)[。.!！~～\s]*$/i.test(
    value,
  );
}

export function deriveEngagement(params: {
  message: EngagementMessage;
  /** 时间正序、不含当前消息 */
  recent: EngagementMessage[];
  replyTargets: Map<string, ReplyTarget>;
  members: MemberSnapshot[];
  convType: string;
  now?: Date;
}): EngagementContext {
  const { message, recent, replyTargets, members, convType } = params;
  const now = params.now ?? new Date();
  const empty: EngagementContext = { replyToAvatarId: null, continuationAvatarIds: [] };
  if (message.senderType !== 'human') return empty;

  const avatars = members.filter((m) => m.principalType === 'avatar' && m.ownerId);
  const avatarById = new Map(avatars.map((a) => [a.principalId, a]));
  const allowedForOwner = (avatarId: string): boolean => {
    const avatar = avatarById.get(avatarId);
    if (!avatar) return false;
    // 自己的分身只在群聊里参与会话延续（私聊会与对方分身重复响应）
    if (avatar.ownerId === message.senderId && convType !== 'group') return false;
    return true;
  };

  // 1) 回复链：直接回复某条分身消息
  let replyToAvatarId: string | null = null;
  if (message.replyTo) {
    const target = replyTargets.get(message.replyTo);
    if (target?.senderType === 'avatar' && allowedForOwner(target.senderId)) {
      replyToAvatarId = target.senderId;
    }
  }

  // 当前消息已经 @ 了某个分身：显式提及优先，不叠加延续
  const mentionedAvatars = message.mentions.filter((id) => avatarById.has(id));
  if (mentionedAvatars.length > 0) {
    return { replyToAvatarId, continuationAvatarIds: [] };
  }
  if (!isContinuationWorthy(message.text)) {
    return { replyToAvatarId, continuationAvatarIds: [] };
  }

  // 2) 会话窗口：向前找同一发送者最近一次「@ 分身 / 回复分身」
  const windowStart = new Date(now.getTime() - CONTINUATION_WINDOW_MS);
  let anchorIndex = -1;
  let anchorAvatarIds: string[] = [];

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const m = recent[i]!;
    if (m.createdAt < windowStart) break;
    if (m.senderType === 'human') {
      if (m.senderId !== message.senderId) break; // 其他真人插话 → 会话结束
      const mentioned = m.mentions.filter((id) => avatarById.has(id));
      const replied = m.replyTo ? replyTargets.get(m.replyTo) : undefined;
      if (mentioned.length > 0) {
        anchorAvatarIds = mentioned;
        anchorIndex = i;
        break;
      }
      if (replied?.senderType === 'avatar' && avatarById.has(replied.senderId)) {
        anchorAvatarIds = [replied.senderId];
        anchorIndex = i;
        break;
      }
    }
    // 分身/系统消息不打断窗口
  }

  if (anchorIndex < 0) return { replyToAvatarId, continuationAvatarIds: [] };

  // 轮次上限：锚点之后该分身已经回复过 5 次 → 收尾
  const anchorSet = new Set(anchorAvatarIds);
  const repliesAfter = recent
    .slice(anchorIndex + 1)
    .filter((m) => m.senderType === 'avatar' && anchorSet.has(m.senderId)).length;
  if (repliesAfter >= MAX_AVATAR_REPLIES) {
    return { replyToAvatarId, continuationAvatarIds: [] };
  }

  const continuationAvatarIds = [...new Set(anchorAvatarIds)].filter(allowedForOwner);
  return { replyToAvatarId, continuationAvatarIds };
}
