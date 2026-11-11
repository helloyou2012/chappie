/**
 * 控制台 API DTO —— ai-platform :7002 /admin/v1/*（用户级控制台，非系统管理后台）。
 * 鉴权：Bearer 用户 token（经 im-core 内部 verify-token 校验）。
 * 对应设计方案 §12 分身控制台 / 待办与确认中心 / 分身日报。
 */
import { z } from 'zod';
import {
  AgentTask,
  Approval,
  Capability,
  CapabilityGrant,
  DailyReport,
  MemoryItem,
  Policy,
  TaskStep,
  UsageDay,
} from './ai';
import { Avatar } from './identity';

// ---- 分身 ----

export const GetAvatarResponse = z.object({ avatar: Avatar });
export const UpdateAvatarRequest = z.object({
  name: z.string().optional(),
  persona: z.string().optional(),
  dailyBudgetUsd: z.number().positive().optional(),
});
export const FreezeAvatarRequest = z.object({ frozen: z.boolean() });

/** 风格预览：输入一句话，看分身会怎么回 —— 设计方案 §12 */
export const PreviewRequest = z.object({ text: z.string().min(1) });
export const PreviewResponse = z.object({
  reply: z.string(),
  usedProvider: z.string(),
});

// ---- 策略 ----

export const ListPoliciesResponse = z.object({ policies: z.array(Policy) });
export const CreatePolicyRequest = z.object({
  scopeType: Policy.shape.scopeType,
  scopeId: z.string().nullable().optional(),
  name: z.string().default(''),
  rule: Policy.shape.rule,
});
export const UpdatePolicyRequest = z.object({
  name: z.string().optional(),
  rule: Policy.shape.rule.optional(),
  enabled: z.boolean().optional(),
});

// ---- 能力 ----

export const ListCapabilitiesResponse = z.object({
  capabilities: z.array(z.object({ capability: Capability, grant: CapabilityGrant })),
});
export const UpdateGrantRequest = z.object({
  granted: z.boolean(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

// ---- 记忆 ----

export const ListMemoriesQuery = z.object({
  scope: z.enum(['all', 'global', 'contact']).default('all'),
  peerId: z.string().optional(),
});
export const ListMemoriesResponse = z.object({ memories: z.array(MemoryItem) });
export const UpdateMemoryRequest = z.object({
  content: z.string().optional(),
  sensitivity: z.enum(['normal', 'sensitive']).optional(),
});
export const ForgetTopicRequest = z.object({ keyword: z.string().min(1) });

// ---- 任务 / 审批 ----

export const ListTasksQuery = z.object({
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const ListTasksResponse = z.object({ tasks: z.array(AgentTask) });
export const GetTaskResponse = z.object({ task: AgentTask, steps: z.array(TaskStep) });

export const ListApprovalsQuery = z.object({
  status: z.string().optional(),
});
export const ListApprovalsResponse = z.object({ approvals: z.array(Approval) });

// ---- 用量 / 日报 ----

export const GetUsageQuery = z.object({ days: z.number().int().min(1).max(90).default(14) });
export const GetUsageResponse = z.object({
  usage: z.array(UsageDay),
  todayCostUsd: z.number(),
  dailyBudgetUsd: z.number(),
});

export const GetDailyReportQuery = z.object({ date: z.string().optional() });
export const GetDailyReportResponse = z.object({ report: DailyReport.nullable() });
export const GenerateReportResponse = z.object({ report: DailyReport });

// ---------------------------------------------------------------------------
// zod schema → TypeScript 类型导出
// ---------------------------------------------------------------------------

export type GetAvatarResponse = z.infer<typeof GetAvatarResponse>;
export type UpdateAvatarRequest = z.infer<typeof UpdateAvatarRequest>;
export type FreezeAvatarRequest = z.infer<typeof FreezeAvatarRequest>;
export type PreviewRequest = z.infer<typeof PreviewRequest>;
export type PreviewResponse = z.infer<typeof PreviewResponse>;
export type ListPoliciesResponse = z.infer<typeof ListPoliciesResponse>;
export type CreatePolicyRequest = z.infer<typeof CreatePolicyRequest>;
export type UpdatePolicyRequest = z.infer<typeof UpdatePolicyRequest>;
export type ListCapabilitiesResponse = z.infer<typeof ListCapabilitiesResponse>;
export type UpdateGrantRequest = z.infer<typeof UpdateGrantRequest>;
export type ListMemoriesQuery = z.infer<typeof ListMemoriesQuery>;
export type ListMemoriesResponse = z.infer<typeof ListMemoriesResponse>;
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequest>;
export type ForgetTopicRequest = z.infer<typeof ForgetTopicRequest>;
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;
export type ListTasksResponse = z.infer<typeof ListTasksResponse>;
export type GetTaskResponse = z.infer<typeof GetTaskResponse>;
export type ListApprovalsQuery = z.infer<typeof ListApprovalsQuery>;
export type ListApprovalsResponse = z.infer<typeof ListApprovalsResponse>;
export type GetUsageQuery = z.infer<typeof GetUsageQuery>;
export type GetUsageResponse = z.infer<typeof GetUsageResponse>;
export type GetDailyReportQuery = z.infer<typeof GetDailyReportQuery>;
export type GetDailyReportResponse = z.infer<typeof GetDailyReportResponse>;
export type GenerateReportResponse = z.infer<typeof GenerateReportResponse>;
