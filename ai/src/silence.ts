/**
 * 合理沉默：低置信度、未被点名时允许不回复。
 *
 * 只在最保守的场景生效：群聊 + 自动档 + 未被 @ + 低置信度。
 * 私聊、草稿、@、紧急、愤怒、敏感话题、回复延续、主人本人发言一律不沉默。
 *
 * 抽成纯函数，便于测试与灰度调阈值。
 */

import type { AvatarMode } from '@chappie/contract';
import type { Classification } from './classifier';

export interface SilenceInput {
  convType: string;
  systemTag: string | null;
  mode: AvatarMode;
  mentioned: boolean;
  mentionsOwner: boolean;
  senderId: string;
  ownerId: string;
  /** 触发消息是否是回复（回复意味着明确延续，不沉默） */
  hasReply: boolean;
  urgency: Classification['urgency'];
  sentiment: Classification['sentiment'];
  topics: string[];
  text: string;
  ownerName: string | null;
  needReply: boolean;
  confidence: number;
  threshold: number;
}

export function shouldStaySilent(input: SilenceInput): boolean {
  if (input.threshold <= 0) return false;
  if (input.convType !== 'group') return false;
  if (input.systemTag === 'avatar_self') return false;
  if (input.mode !== 'auto') return false;
  if (input.mentioned || input.mentionsOwner) return false;
  if (input.senderId === input.ownerId) return false;
  if (input.hasReply) return false;
  if (input.urgency === 'high' || input.sentiment === 'angry') return false;
  if (input.topics.length > 0) return false;
  if (input.ownerName && input.text.includes(input.ownerName)) return false;
  return input.needReply && input.confidence < input.threshold;
}
