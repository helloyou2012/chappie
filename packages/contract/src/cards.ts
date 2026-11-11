/**
 * AI 专用交互卡片 —— 设计方案 §5.2。
 * 所有卡片以 content.type = "card" 的消息投递到「主人 ↔ 分身」的系统会话（systemTag=avatar_self），
 * 保证除主人外无人可见；审批中心另行聚合 approval 表。
 */
import { z } from 'zod';
import { RiskLevel } from './identity';

/** 草稿卡片：半自动档生成的待发送内容 */
export const DraftCard = z.object({
  kind: z.literal('draft'),
  taskId: z.string(),
  /** 建议发送的回复文本 */
  draftText: z.string(),
  /** 为什么这么回 */
  reason: z.string().default(''),
  /** 草稿要发往的会话 */
  targetConvId: z.string(),
  replyToMsgId: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
});
export type DraftCard = z.infer<typeof DraftCard>;

/** 确认卡片：L2 高风险操作需主人批准 */
export const ApprovalCard = z.object({
  kind: z.literal('approval'),
  approvalId: z.string(),
  taskId: z.string(),
  title: z.string(),
  summary: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  risk: RiskLevel,
  expiresAt: z.string().nullable().default(null),
});
export type ApprovalCard = z.infer<typeof ApprovalCard>;

export const TaskCardStep = z.object({
  name: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed']),
  detail: z.string().optional(),
});
export type TaskCardStep = z.infer<typeof TaskCardStep>;

/** 任务卡片：长任务进度、中间产物、可取消 */
export const TaskCard = z.object({
  kind: z.literal('task'),
  taskId: z.string(),
  title: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  steps: z.array(TaskCardStep).default([]),
});
export type TaskCard = z.infer<typeof TaskCard>;

/** 转交卡片：不确定即转人（置信度低/情绪激烈/涉金额法律隐私） */
export const HandoverCard = z.object({
  kind: z.literal('handover'),
  taskId: z.string(),
  /** 交给主人的上下文摘要 */
  summary: z.string(),
  reason: z.string().default(''),
});
export type HandoverCard = z.infer<typeof HandoverCard>;

/** 分身日报卡片 */
export const ReportCard = z.object({
  kind: z.literal('report'),
  reportId: z.string(),
  /** YYYY-MM-DD */
  day: z.string(),
  summary: z.string(),
});
export type ReportCard = z.infer<typeof ReportCard>;

export const CardPayload = z.discriminatedUnion('kind', [
  DraftCard,
  ApprovalCard,
  TaskCard,
  HandoverCard,
  ReportCard,
]);
export type CardPayload = z.infer<typeof CardPayload>;

/** 卡片操作（POST /api/v1/cards/:msgId/action） */
export const CardAction = z.enum([
  'send', // 草稿：直接发送
  'edit', // 草稿：修改后发送
  'discard', // 草稿：丢弃
  'approve', // 审批：批准
  'modify_approve', // 审批：修改参数后批准
  'reject', // 审批：拒绝
  'cancel', // 任务：取消
]);
export type CardAction = z.infer<typeof CardAction>;

export const CardActionRequest = z.object({
  action: CardAction,
  /** edit / modify_approve 时的修改内容 */
  editedText: z.string().optional(),
});
export type CardActionRequest = z.infer<typeof CardActionRequest>;
