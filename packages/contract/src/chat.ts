/**
 * 会话与消息 —— 设计方案 §5.1 消息结构、§6 会话与消息。
 *
 * 契约纪律：字段只加不改；新内容类型只增 discriminatedUnion 分支；
 * 客户端遇到不认识的 content.type 必须降级为文本展示（见 shared/unsafe）。
 */
import { z } from 'zod';
import { CardPayload } from './cards';
import {
  AvatarMode,
  PrincipalType,
  ReceptionSource,
  ReceptionState,
  ReceptionStrategy,
} from './identity';

// ---------------------------------------------------------------------------
// 消息内容（可扩展注册表）
// ---------------------------------------------------------------------------

/**
 * 群聊「@所有人」的广播标记。
 *
 * 不是真实 principal（不会出现在成员表里）：客户端把它放进 mentions 数组，
 * 路由层据此识别「广播提及」——只对人类成员生效的通知语义，
 * 但不按普通 @ 的排他规则压制各成员分身代答。
 */
export const ALL_MENTION_ID = '__all__';

const SchemaVersion = z.number().int().default(1);

export const TextPayload = z.object({
  type: z.literal('text'),
  schemaVersion: SchemaVersion,
  text: z.string(),
});
export type TextPayload = z.infer<typeof TextPayload>;

export const ImagePayload = z.object({
  type: z.literal('image'),
  schemaVersion: SchemaVersion,
  url: z.string(),
  name: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});

export const FilePayload = z.object({
  type: z.literal('file'),
  schemaVersion: SchemaVersion,
  url: z.string(),
  name: z.string(),
  size: z.number().int().optional(),
});

export const CardContent = z.object({
  type: z.literal('card'),
  schemaVersion: SchemaVersion,
  card: CardPayload,
});

/**
 * 消息内容 discriminatedUnion。
 * 注意：新增类型时三端渲染器同步实现，未识别类型降级为文本（设计方案 §5.1）。
 */
export const Content = z.discriminatedUnion('type', [
  TextPayload,
  ImagePayload,
  FilePayload,
  CardContent,
]);
export type Content = z.infer<typeof Content>;

export function contentText(c: Content | null | undefined): string {
  if (!c) return '';
  switch (c.type) {
    case 'text':
      return c.text;
    case 'image':
      return `[图片] ${c.name ?? ''}`.trim();
    case 'file':
      return `[文件] ${c.name}`;
    case 'card': {
      const k = c.card;
      switch (k.kind) {
        case 'draft':
          return '[草稿卡片]';
        case 'approval':
          return `[确认卡片] ${k.title}`;
        case 'task':
          return `[任务卡片] ${k.title}`;
        case 'handover':
          return '[转交卡片]';
        case 'report':
          return `[分身日报] ${k.day}`;
        case 'calendar_reminder':
          return `[日程提醒] ${k.title}`;
        case 'reception_digest':
          return '[分身接待摘要]';
        case 'human_request':
          return `[请求真人] ${k.requesterName}`;
      }
      return '[卡片]';
    }
  }
}

// ---------------------------------------------------------------------------
// AI 元信息
// ---------------------------------------------------------------------------

/** 解释卡片数据：内嵌在 AI 消息 aiMeta 上，点击「AI 代发」角标展开 —— 设计方案 §12 */
export const Explanation = z.object({
  decision: z.string(),
  reason: z.string(),
  confidence: z.number(),
  toolsUsed: z.array(z.string()).default([]),
  memoriesUsed: z.array(z.string()).default([]),
});
export type Explanation = z.infer<typeof Explanation>;

/** Agent 活动时间线条目：思考 / 工具调用 / 中间消息（仅主人可见） */
export const AgentActivityItem = z.object({
  kind: z.enum(['thinking', 'tool', 'message']),
  title: z.string(),
  /** 一行摘要，展示在标题右侧（命令、文件名、参数等） */
  detail: z.string().default(''),
  status: z.enum(['running', 'done', 'failed']).default('done'),
  /** 展开后的内容（工具参数/结果、命令输出等） */
  content: z.string().default(''),
  /** 工具 id（用于前端选图标） */
  toolId: z.string().optional(),
});
export type AgentActivityItem = z.infer<typeof AgentActivityItem>;

export const AiMeta = z.object({
  taskId: z.string().nullable().default(null),
  mode: AvatarMode.nullable().default(null),
  toolsUsed: z.array(z.string()).default([]),
  risk: z.string().nullable().default(null),
  confidence: z.number().nullable().default(null),
  /** AI 对 AI 跳数，防互聊死循环 —— 设计方案 §29.6 */
  hopCount: z.number().int().default(0),
  /** 发送时捕获的接待版本；core 在写入路径做围栏校验，旧版本直接拒绝 */
  authorityVersion: z.number().int().default(0),
  /** 本次发送的触发来源（mention/self_chat/direct/auto/reply/continuation/owner_approved） */
  via: z.string().nullable().default(null),
  explanation: Explanation.nullable().default(null),
  /** 流式生成中：内容会持续更新，客户端可显示打字光标 */
  streaming: z.boolean().default(false),
  /** 仅主人可见：流式中的消息，或最终未对外发送（转草稿/护栏/转交）的消息 */
  ownerOnly: z.boolean().default(false),
  /** 扩展思考内容：仅主人可见（读路径按 viewer 剥离），前端可折叠展示 */
  thinking: z.string().optional(),
  /** 工具调用活动时间线：仅主人可见（与 thinking 同视角剥离） */
  activity: z.array(AgentActivityItem).optional(),
});
export type AiMeta = z.infer<typeof AiMeta>;

// ---------------------------------------------------------------------------
// 消息
// ---------------------------------------------------------------------------

export const Message = z.object({
  msgId: z.string(),
  convId: z.string(),
  seq: z.number().int(),
  /** 客户端幂等键：客户端用它把乐观消息与服务端消息精确对账；卡片/历史消息可能为 null */
  clientMsgId: z.string().nullable().default(null),
  senderId: z.string(),
  senderType: PrincipalType,
  /** 分身代发时为主人 user id —— 设计方案 §2「发送者与代表者分离」 */
  onBehalfOf: z.string().nullable().default(null),
  content: Content,
  mentions: z.array(z.string()).default([]),
  replyTo: z.string().nullable().default(null),
  aiMeta: AiMeta.nullable().default(null),
  /** 撤回后为 true；撤回消息不返回原文 */
  recalled: z.boolean().default(false),
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;

// ---------------------------------------------------------------------------
// 会话与成员
// ---------------------------------------------------------------------------

export const ConversationType = z.enum(['direct', 'group']);

export const Conversation = z.object({
  id: z.string(),
  type: ConversationType,
  title: z.string().nullable().default(null),
  /** 系统标记：avatar_self = 主人与分身的系统会话（控制通道） */
  systemTag: z.string().nullable().default(null),
  lastSeq: z.number().int(),
  createdAt: z.string(),
});
export type Conversation = z.infer<typeof Conversation>;

export const MemberRole = z.enum(['owner', 'member']);

/** 档位是用户显式选择还是继承策略（用于区分「显式手动」与「默认手动」）。 */
export const AiModeSource = z.enum(['explicit', 'inherit']);
export type AiModeSource = z.infer<typeof AiModeSource>;

/** 某个会话中某位主人的接待态投影 */
export const ReceptionView = z.object({
  state: ReceptionState,
  strategy: ReceptionStrategy,
  /** 单调递增的授权版本：AI 发送时必须回传，旧版本会被 core 拒绝 */
  version: z.number().int().default(0),
  /** 临时接待态到期时间（ISO）；null 表示无期限 */
  until: z.string().nullable().default(null),
  source: ReceptionSource.default('default'),
  /** 对端是否可以请求真人接管 */
  counterpartyRequestable: z.boolean().default(true),
});
export type ReceptionView = z.infer<typeof ReceptionView>;

export const Member = z.object({
  convId: z.string(),
  principalId: z.string(),
  role: MemberRole,
  /** 该成员的分身在此会话的档位（仅 avatar 成员有意义；human 成员表示其分身档位） */
  aiMode: AvatarMode.default('manual'),
  aiModeSource: AiModeSource.default('inherit'),
  aiModeUntil: z.string().nullable().default(null),
  lastReadSeq: z.number().int().default(0),
  joinedAt: z.string(),
});
export type Member = z.infer<typeof Member>;

/** 成员视图：member + principal 展开 + 在线状态 */
export const MemberView = z.object({
  principalId: z.string(),
  principalType: PrincipalType,
  ownerId: z.string().nullable().default(null),
  name: z.string(),
  role: MemberRole,
  /** 成员（或 avatar 的主人）的职位/角色 */
  jobRole: z.string().default(''),
  /** 成员（或 avatar 的主人）的部门 */
  department: z.string().default(''),
  aiMode: AvatarMode,
  aiModeSource: AiModeSource.default('inherit'),
  aiModeUntil: z.string().nullable().default(null),
  /** 该主人（human 成员）在此会话的接待态；avatar 成员为 null */
  reception: ReceptionView.nullable().default(null),
  lastReadSeq: z.number().int(),
  online: z.boolean().default(false),
});
export type MemberView = z.infer<typeof MemberView>;

/** 会话视图：会话 + 我的成员视角 + 未读 —— GET /api/v1/conversations 返回 */
export const ConversationView = z.object({
  conversation: Conversation,
  myPrincipalId: z.string(),
  myRole: MemberRole,
  myAiMode: AvatarMode,
  myAiModeSource: AiModeSource.default('inherit'),
  myAiModeUntil: z.string().nullable().default(null),
  myReception: ReceptionView,
  /** 单聊时对方的接待态；群聊/系统会话为 null */
  peerReception: ReceptionView.nullable().default(null),
  myLastReadSeq: z.number().int().default(0),
  unreadCount: z.number().int().default(0),
  /** 会话展示名（direct：对方名；group：群名；avatar_self：我的分身） */
  displayTitle: z.string(),
  /** 最近一条消息预览 */
  lastMsgPreview: z.string().nullable().default(null),
  lastMsgAt: z.string().nullable().default(null),
  lastMsgSenderId: z.string().nullable().default(null),
  /** 最后一条消息发送者名称（群聊列表展示「发送者: 内容」） */
  lastMsgSenderName: z.string().nullable().default(null),
});
export type ConversationView = z.infer<typeof ConversationView>;
