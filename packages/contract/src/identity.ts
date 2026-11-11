/**
 * 身份与主体 —— 设计方案 §2 核心概念模型、§6 身份与关系。
 *
 * ID 规则（前缀区分主体类型，便于三端快速判断）：
 *   human  → u_xxxxxxxx-xxxx（UUID，前缀 u_）
 *   avatar → a_xxxxxxxx-xxxx
 *   system → sys
 */
import { z } from 'zod';

/** 主体类型：human | avatar | system（bot/service 预留，见设计方案 §2） */
export const PrincipalType = z.enum(['human', 'avatar', 'system']);
export type PrincipalType = z.infer<typeof PrincipalType>;

export const Principal = z.object({
  id: z.string(),
  type: PrincipalType,
  /** avatar 主体指向其主人的 user id */
  ownerId: z.string().nullable().default(null),
  name: z.string().default(''),
  status: z.enum(['active', 'frozen']).default('active'),
});
export type Principal = z.infer<typeof Principal>;

export const User = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type User = z.infer<typeof User>;

/** 档位：手动/草稿/自动/静默 —— 设计方案 §4.1 */
export const AvatarMode = z.enum(['manual', 'draft', 'auto', 'off']);
export type AvatarMode = z.infer<typeof AvatarMode>;

export const AvatarStatus = z.enum(['active', 'frozen']);
export type AvatarStatus = z.infer<typeof AvatarStatus>;

/** 分身（归 ai-platform 所有的完整定义；im-core 侧仅持有 principal 行） */
export const Avatar = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  persona: z.string(),
  modelProfile: z.string().default('default'),
  status: AvatarStatus,
  selfConvId: z.string().nullable().default(null),
  dailyBudgetUsd: z.number().default(1.0),
  version: z.number().int().default(1),
});
export type Avatar = z.infer<typeof Avatar>;

/** 能力风险等级 —— 设计方案 §8.2 */
export const RiskLevel = z.enum(['L0', 'L1', 'L2', 'L3']);
export type RiskLevel = z.infer<typeof RiskLevel>;
