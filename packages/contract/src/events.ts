/**
 * Outbox 事件契约 —— Rust 在业务事务内写入 outbox 表，Bun worker 消费。
 * 对应设计方案 §28.1 事件总线主题（此处以 PG outbox 承载，§24 演进约定）。
 *
 * 所有事件 envelope 带 eventId / topic / traceId / occurredAt；消费端必须幂等。
 */
import { z } from 'zod';
import { Message } from './chat';

export const OutboxEvent = z.object({
  eventId: z.string(),
  topic: z.string(),
  /** 排序键：会话事件的 convId / 用户事件的 userId */
  key: z.string().nullable().default(null),
  traceId: z.string().nullable().default(null),
  occurredAt: z.string(),
});
export type OutboxEvent = z.infer<typeof OutboxEvent>;

export const MemberSnapshot = z.object({
  principalId: z.string(),
  principalType: z.string(),
  ownerId: z.string().nullable().default(null),
});
export type MemberSnapshot = z.infer<typeof MemberSnapshot>;

/** 新用户注册（Rust → Bun：创建 avatar + 默认策略 + 分身会话） */
export const UserCreatedData = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
});

/** 消息创建（AI 链路主入口） */
export const MessageCreatedData = z.object({
  message: Message,
  /** 事件发生时会话成员快照，router 用于判定候选分身 */
  members: z.array(MemberSnapshot),
});

export const MessageRecalledData = z.object({
  msgId: z.string(),
  convId: z.string(),
  actorId: z.string(),
});

/** 档位/策略变更（Bun 失效 ai:policy 缓存） */
export const PolicyChangedData = z.object({
  userId: z.string(),
  convId: z.string().nullable().default(null),
});

/** 卡片操作（草稿发送/审批决议/任务取消） */
export const CardActionData = z.object({
  msgId: z.string(),
  /** 目标会话（卡片所在会话） */
  convId: z.string(),
  actorId: z.string(),
  action: z.string(),
  editedText: z.string().optional(),
  card: z.unknown(),
});

/** 反馈（点赞/纠正/举报 → 偏好学习与评测集） */
export const FeedbackSubmittedData = z.object({
  msgId: z.string(),
  convId: z.string(),
  actorId: z.string(),
  feedbackType: z.string(),
  correctedText: z.string().optional(),
  reason: z.string().optional(),
});

/** 接管请求：取消该用户在此会话的进行中任务并冷却 */
export const TakeoverRequestedData = z.object({
  userId: z.string(),
  convId: z.string(),
});

export const EVENT_TOPICS = [
  'user.created',
  'message.created',
  'message.recalled',
  'policy.changed',
  'card.action',
  'feedback.submitted',
  'takeover.requested',
  'member.changed',
] as const;
export type EventTopic = (typeof EVENT_TOPICS)[number];
