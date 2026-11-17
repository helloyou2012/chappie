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

// ---------------------------------------------------------------------------
// 联系人（取代演示用的全站目录：只看得到自己添加的联系人）
// ---------------------------------------------------------------------------

export const ContactView = z.object({
  user: User,
  /** 备注名，可选 */
  alias: z.string().nullable().default(null),
  createdAt: z.string(),
});

export const ListContactsResponse = z.object({ contacts: z.array(ContactView) });

/** 按邮箱添加联系人（对方需已注册） */
export const AddContactRequest = z.object({ email: z.string().email() });
export const AddContactResponse = z.object({ contact: ContactView });
export const RemoveContactResponse = z.object({ ok: z.boolean() });

/** 更新联系人备注名；传空串或 null 清除 */
export const UpdateContactRequest = z.object({
  alias: z.string().max(40).nullable(),
});
export const UpdateContactResponse = z.object({ contact: ContactView });

// ---------------------------------------------------------------------------
// 会话成员管理（群聊）
// ---------------------------------------------------------------------------

export const AddMembersRequest = z.object({
  memberUserIds: z.array(z.string()).min(1),
});
export const AddMembersResponse = z.object({ members: z.array(MemberView) });
export const RemoveMemberResponse = z.object({ ok: z.boolean() });

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
export type ContactView = z.infer<typeof ContactView>;
export type ListContactsResponse = z.infer<typeof ListContactsResponse>;
export type AddContactRequest = z.infer<typeof AddContactRequest>;
export type AddContactResponse = z.infer<typeof AddContactResponse>;
export type RemoveContactResponse = z.infer<typeof RemoveContactResponse>;
export type UpdateContactRequest = z.infer<typeof UpdateContactRequest>;
export type UpdateContactResponse = z.infer<typeof UpdateContactResponse>;
export type AddMembersRequest = z.infer<typeof AddMembersRequest>;
export type AddMembersResponse = z.infer<typeof AddMembersResponse>;
export type RemoveMemberResponse = z.infer<typeof RemoveMemberResponse>;
export type UpdateConversationSettingsRequest = z.infer<typeof UpdateConversationSettingsRequest>;
export type TakeoverResponse = z.infer<typeof TakeoverResponse>;
export type FeedbackRequest = z.infer<typeof FeedbackRequest>;
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponse>;
export type ListDevicesResponse = z.infer<typeof ListDevicesResponse>;
