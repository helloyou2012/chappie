/**
 * 对外 REST API 请求/响应 DTO —— im-core :7000 /api/v1/*
 * 对应设计方案 §28.3 客户端接口（HTTPS 部分）。
 */
import { z } from 'zod';
import { FeedbackType } from './ai';
import { CardActionRequest } from './cards';
import { ConversationView, MemberView, Message } from './chat';
import { DeviceCapabilities, DevicePlatform, DeviceView } from './device';
import { AvatarMode, User } from './identity';

// ---------------------------------------------------------------------------
// 认证（邮箱 + 验证码）
// ---------------------------------------------------------------------------

export const SendCodeRequest = z.object({ email: z.string().email() });
export const SendCodeResponse = z.object({
  /** 仅 AUTH_CODE_DEV_ECHO=true 时返回，方便本地演示；生产恒为 null */
  devCode: z.string().nullable().default(null),
  expiresInSeconds: z.number().int(),
});

export const VerifyCodeRequest = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
});
export const VerifyCodeResponse = z.object({
  token: z.string(),
  user: User,
  /** token 过期时间（ISO） */
  expiresAt: z.string(),
});

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

export const MeResponse = z.object({ user: User });

export const CreateConversationRequest = z
  .object({
    type: z.enum(['direct', 'group']),
    /** direct: 对方 userId；group: 成员 userId 列表 */
    memberUserIds: z.array(z.string()).default([]),
    title: z.string().optional(),
  })
  .refine(
    (v) => (v.type === 'direct' ? v.memberUserIds.length === 1 : v.memberUserIds.length >= 1),
    {
      message: 'direct 会话需恰好 1 个对方成员；group 至少 1 个',
    },
  );
export const CreateConversationResponse = z.object({ view: ConversationView });

export const ListConversationsResponse = z.object({ views: z.array(ConversationView) });

export const ListMessagesQuery = z.object({
  beforeSeq: z.number().int().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const ListMessagesResponse = z.object({
  messages: z.array(Message),
  hasMore: z.boolean().default(false),
});

export const ListMembersResponse = z.object({ members: z.array(MemberView) });

/** 会话设置：切换我的分身在此会话的档位（支持临时模式） */
export const UpdateConversationSettingsRequest = z.object({
  aiMode: AvatarMode.optional(),
  /** 临时档位时长（小时），过期自动回落；不传 = 永久 */
  tempHours: z.number().int().min(1).max(72).optional(),
});

export const TakeoverResponse = z.object({ ok: z.boolean() });

// ---------------------------------------------------------------------------
// 卡片 / 反馈 / 设备
// ---------------------------------------------------------------------------

export { CardActionRequest };

export const FeedbackRequest = z.object({
  type: FeedbackType,
  correctedText: z.string().optional(),
  reason: z.string().optional(),
});

export const RegisterDeviceRequest = z.object({
  deviceId: z.string(),
  platform: DevicePlatform,
  appVersion: z.string().optional(),
  capabilities: DeviceCapabilities.optional(),
  pushToken: z.string().optional(),
});
export const RegisterDeviceResponse = z.object({ ok: z.boolean() });
export const ListDevicesResponse = z.object({ devices: z.array(DeviceView) });

// ---------------------------------------------------------------------------
// 通用错误体
// ---------------------------------------------------------------------------

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const ApiErrorCodes = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'internal',
] as const;
export type ApiErrorCode = (typeof ApiErrorCodes)[number];

// ---------------------------------------------------------------------------
// zod schema → TypeScript 类型导出（客户端以类型方式引用）
// ---------------------------------------------------------------------------

export type SendCodeRequest = z.infer<typeof SendCodeRequest>;
export type SendCodeResponse = z.infer<typeof SendCodeResponse>;
export type VerifyCodeRequest = z.infer<typeof VerifyCodeRequest>;
export type VerifyCodeResponse = z.infer<typeof VerifyCodeResponse>;
export type MeResponse = z.infer<typeof MeResponse>;
export type CreateConversationRequest = z.infer<typeof CreateConversationRequest>;
export type CreateConversationResponse = z.infer<typeof CreateConversationResponse>;
export type ListConversationsResponse = z.infer<typeof ListConversationsResponse>;
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;
export type ListMessagesResponse = z.infer<typeof ListMessagesResponse>;
export type ListMembersResponse = z.infer<typeof ListMembersResponse>;
export type UpdateConversationSettingsRequest = z.infer<typeof UpdateConversationSettingsRequest>;
export type TakeoverResponse = z.infer<typeof TakeoverResponse>;
export type FeedbackRequest = z.infer<typeof FeedbackRequest>;
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponse>;
export type ListDevicesResponse = z.infer<typeof ListDevicesResponse>;
