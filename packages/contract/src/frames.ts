/**
 * WebSocket 帧协议 —— JSON 文本帧，discriminatedUnion 定义。
 *
 * 连接生命周期：connect → auth（首帧，超时 10s 断开）→ heartbeat（客户端 25s，
 * 服务端 60s 无心跳断开）→ 业务帧。断线重连后按 seq 断洞 pull_messages 补齐。
 */
import { z } from 'zod';
import { Content, Message } from './chat';
import { User } from './identity';

// ---------------------------------------------------------------------------
// 客户端 → 服务端
// ---------------------------------------------------------------------------

export const ClientFrame = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    token: z.string(),
    /** web | desktop | ios | android */
    platform: z.string().default('web'),
    deviceId: z.string().optional(),
  }),
  z.object({ type: z.literal('heartbeat'), ts: z.number() }),

  /** 发送消息（幂等键 clientMsgId，重复发送返回相同 ack） */
  z.object({
    type: z.literal('send_message'),
    clientMsgId: z.string(),
    convId: z.string(),
    content: Content,
    mentions: z.array(z.string()).default([]),
    replyTo: z.string().nullable().default(null),
  }),
  /** 输入中状态（5 秒 TTL） */
  z.object({ type: z.literal('typing'), convId: z.string() }),
  /** 已读上报 */
  z.object({ type: z.literal('mark_read'), convId: z.string(), seq: z.number().int() }),
  /** 撤回自己的（或自己分身的）消息 */
  z.object({ type: z.literal('recall_message'), msgId: z.string() }),
  /** 按 seq 补洞：拉取 (fromSeq, fromSeq+limit] 区间消息 */
  z.object({
    type: z.literal('pull_messages'),
    convId: z.string(),
    fromSeq: z.number().int(),
    limit: z.number().int().default(50),
  }),
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

// ---------------------------------------------------------------------------
// 服务端 → 客户端
// ---------------------------------------------------------------------------

export const ServerFrame = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth_ok'),
    user: User,
    serverTime: z.string(),
  }),
  z.object({ type: z.literal('auth_error'), message: z.string() }),
  z.object({ type: z.literal('heartbeat_ack'), ts: z.number() }),

  /** 新消息（本人或本会话成员均通过此帧收到，含分身代发） */
  z.object({ type: z.literal('message_created'), message: Message }),
  /** 发送确认（send_message 的 ack） */
  z.object({
    type: z.literal('message_acked'),
    clientMsgId: z.string(),
    msgId: z.string(),
    seq: z.number().int(),
    serverTime: z.string(),
  }),
  /** 消息撤回 */
  z.object({ type: z.literal('message_recalled'), convId: z.string(), msgId: z.string() }),
  /** 卡片内容更新（任务进度等） */
  z.object({ type: z.literal('message_updated'), message: Message }),
  /** 消息批量返回（pull_messages 响应） */
  z.object({
    type: z.literal('messages_batch'),
    convId: z.string(),
    messages: z.array(Message),
    hasMore: z.boolean().default(false),
  }),
  /** 输入中 */
  z.object({
    type: z.literal('typing'),
    convId: z.string(),
    principalId: z.string(),
    untilTs: z.number(),
  }),
  /** 在线状态变更 */
  z.object({
    type: z.literal('presence'),
    principalId: z.string(),
    online: z.boolean(),
  }),
  /** 已读同步 */
  z.object({
    type: z.literal('read_sync'),
    convId: z.string(),
    principalId: z.string(),
    lastReadSeq: z.number().int(),
  }),
  /** 会话信息刷新（成员/档位变化等，客户端据此重新拉取） */
  z.object({ type: z.literal('conversations_changed') }),
  z.object({ type: z.literal('error'), code: z.string().default('error'), message: z.string() }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;
