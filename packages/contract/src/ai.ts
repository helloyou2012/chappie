/**
 * AI 平台数据契约 —— 策略、任务、审批、记忆、能力、反馈、日报。
 * 对应设计方案 §4 档位与策略引擎、§6 数据模型、§8 能力体系、§9 记忆。
 */
import { z } from 'zod';
import { AvatarMode, RiskLevel } from './identity';

// ---------------------------------------------------------------------------
// 策略 —— 设计方案 §4.2（规则 + 作用域，优先级：会话 > 联系人 > 日程 > 全局）
// ---------------------------------------------------------------------------

export const PolicyScopeType = z.enum([
  'global', // 全局默认
  'contact', // 联系人（scopeId = 对方 userId）
  'contact_group', // 联系人分组（scopeId = 分组名）
  'conversation', // 会话（scopeId = convId）
  'schedule', // 日程/场景模板（scopeId = 模板 id）
]);
export type PolicyScopeType = z.infer<typeof PolicyScopeType>;

export const ScheduleWindow = z.object({
  /** 星期几（1=周一 … 7=周日），空数组 = 每天 */
  days: z.array(z.number().int().min(1).max(7)).default([]),
  /** "HH:MM" */
  start: z.string(),
  end: z.string(),
});
export type ScheduleWindow = z.infer<typeof ScheduleWindow>;

export const PolicyRule = z.object({
  mode: AvatarMode,
  schedule: z.array(ScheduleWindow).default([]),
  allowCapabilities: z.array(z.string()).nullable().default(null),
  denyTopics: z.array(z.string()).default([]),
  maxRisk: RiskLevel.default('L1'),
  /** 每小时自动回复上限 */
  rateLimitPerHour: z.number().int().default(20),
  escalateWhen: z.array(z.string()).default([]),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const Policy = z.object({
  id: z.string(),
  ownerId: z.string(),
  scopeType: PolicyScopeType,
  scopeId: z.string().nullable().default(null),
  name: z.string().default(''),
  rule: PolicyRule,
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
  version: z.number().int().default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Policy = z.infer<typeof Policy>;

/** 策略模板（控制台一键套用） —— 设计方案 §12 */
export const POLICY_TEMPLATES = [
  { id: 'work', name: '上班模式', rule: { mode: 'draft', maxRisk: 'L1', rateLimitPerHour: 10 } },
  { id: 'meeting', name: '会议中', rule: { mode: 'manual', maxRisk: 'L0', rateLimitPerHour: 5 } },
  { id: 'vacation', name: '休假', rule: { mode: 'auto', maxRisk: 'L1', rateLimitPerHour: 30 } },
  { id: 'sleep', name: '睡眠', rule: { mode: 'off', maxRisk: 'L0', rateLimitPerHour: 0 } },
] as const;

// ---------------------------------------------------------------------------
// 任务与审批 —— 设计方案 §7.2 任务状态机、§6 任务与审计
// ---------------------------------------------------------------------------

export const TaskStatus = z.enum([
  'created',
  'planning',
  'waiting_approval',
  'running',
  'waiting_user_input',
  'completed',
  'failed',
  'cancelled',
  'handed_over',
  'skipped',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskDecision = z.object({
  action: z.string(),
  reason: z.string(),
  confidence: z.number(),
});
export type TaskDecision = z.infer<typeof TaskDecision>;

export const AgentTask = z.object({
  id: z.string(),
  avatarId: z.string(),
  ownerId: z.string(),
  triggerMsgId: z.string().nullable().default(null),
  triggerConvId: z.string().nullable().default(null),
  triggerKind: z.string(),
  status: TaskStatus,
  result: z.string().nullable().default(null),
  decision: TaskDecision.nullable().default(null),
  costUsd: z.number().default(0),
  tokensUsed: z.number().int().default(0),
  traceId: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentTask = z.infer<typeof AgentTask>;

export const TaskStep = z.object({
  id: z.number(),
  taskId: z.string(),
  idx: z.number().int(),
  type: z.string(),
  input: z.unknown().nullable().default(null),
  output: z.unknown().nullable().default(null),
  model: z.string().nullable().default(null),
  tokens: z.number().int().nullable().default(null),
  latencyMs: z.number().int().nullable().default(null),
  createdAt: z.string(),
});
export type TaskStep = z.infer<typeof TaskStep>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'modified', 'rejected', 'expired']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const Approval = z.object({
  id: z.string(),
  taskId: z.string(),
  avatarId: z.string(),
  approver: z.string(),
  title: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  status: ApprovalStatus,
  cardMsgId: z.string().nullable().default(null),
  expiresAt: z.string(),
  resolvedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Approval = z.infer<typeof Approval>;

// ---------------------------------------------------------------------------
// 能力（工具）—— 设计方案 §8
// ---------------------------------------------------------------------------

export const Capability = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  riskLevel: RiskLevel,
  provider: z.string().default('builtin'),
  version: z.number().int().default(1),
  /** 参数 JSON Schema（演示用简 schema） */
  schema: z.record(z.string(), z.unknown()).default({}),
});
export type Capability = z.infer<typeof Capability>;

export const CapabilityGrant = z.object({
  capabilityId: z.string(),
  granted: z.boolean(),
  constraints: z.record(z.string(), z.unknown()).default({}),
});
export type CapabilityGrant = z.infer<typeof CapabilityGrant>;

// ---------------------------------------------------------------------------
// 记忆 —— 设计方案 §9（分层：情景/语义/关系/程序；治理：来源/敏感/置信/TTL）
// ---------------------------------------------------------------------------

export const MemoryScope = z.enum(['global', 'contact']);
export const MemoryType = z.enum([
  'fact', // 语义：稳定事实
  'preference', // 语义：偏好
  'commitment', // 情景：承诺（「周四答应给张三报价」）
  'relationship', // 关系：与联系人的沟通风格/亲疏/禁忌
  'procedure', // 程序：处理某类事情的习惯做法
  'episode', // 情景：事件
]);
export const MemorySensitivity = z.enum(['normal', 'sensitive']);

export const MemoryItem = z.object({
  id: z.string(),
  avatarId: z.string(),
  scope: MemoryScope,
  /** scope=contact 时：仅对联系人的对话可用（跨联系人隔离） */
  peerId: z.string().nullable().default(null),
  type: MemoryType,
  content: z.string(),
  keywords: z.array(z.string()).default([]),
  sensitivity: MemorySensitivity.default('normal'),
  confidence: z.number().default(0.8),
  sourceMsgId: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

export const StyleProfile = z.object({
  avatarId: z.string(),
  features: z.object({
    tone: z.string().default(''),
    avgLength: z.string().default(''),
    emoji: z.string().default(''),
    catchphrases: z.array(z.string()).default([]),
  }),
  examples: z.array(z.string()).default([]),
  updatedAt: z.string(),
});
export type StyleProfile = z.infer<typeof StyleProfile>;

// ---------------------------------------------------------------------------
// 反馈与用量
// ---------------------------------------------------------------------------

export const FeedbackType = z.enum(['like', 'correct', 'report', 'accept', 'reject']);
export type FeedbackType = z.infer<typeof FeedbackType>;

export const Feedback = z.object({
  id: z.number(),
  msgId: z.string(),
  taskId: z.string().nullable().default(null),
  actor: z.string(),
  type: FeedbackType,
  diff: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Feedback = z.infer<typeof Feedback>;

export const UsageDay = z.object({
  day: z.string(),
  provider: z.string(),
  model: z.string(),
  requests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
});
export type UsageDay = z.infer<typeof UsageDay>;

// ---------------------------------------------------------------------------
// 分身日报 —— 设计方案 §12
// ---------------------------------------------------------------------------

export const DailyReport = z.object({
  id: z.string(),
  avatarId: z.string(),
  day: z.string(),
  summary: z.string(),
  stats: z.object({
    repliedCount: z.number().int().default(0),
    tasksCompleted: z.number().int().default(0),
    draftsSent: z.number().int().default(0),
    draftsDiscarded: z.number().int().default(0),
    handovers: z.number().int().default(0),
    approvalsPending: z.number().int().default(0),
    acceptedRate: z.number().default(0),
    costUsd: z.number().default(0),
  }),
  pendingDecisions: z
    .array(
      z.object({
        kind: z.string(),
        title: z.string(),
        detail: z.string().default(''),
      }),
    )
    .default([]),
  cardMsgId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type DailyReport = z.infer<typeof DailyReport>;

// ---------------------------------------------------------------------------
// 日程 / 待办（分身工具 toolData：calendar / todo）—— 设计方案 §8 内置能力
// ---------------------------------------------------------------------------

export const CalendarItem = z.object({
  title: z.string(),
  /** 事件日期 YYYY-MM-DD；旧数据可能是自由文本时间、无法解析时为 null */
  date: z.string().nullable().default(null),
  /** 时间 HH:mm；旧数据可能是自由文本（如 "tomorrow 14:00"） */
  time: z.string(),
});
export type CalendarItem = z.infer<typeof CalendarItem>;

export const TodoItem = z.object({
  text: z.string(),
  done: z.boolean().default(false),
});
export type TodoItem = z.infer<typeof TodoItem>;
