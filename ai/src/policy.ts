/**
 * 策略引擎 —— 设计方案 §4.2/§4.3/§27.3 第 3 步。
 *
 * 档位合并规则（实现约定，见 README）：
 *   1. 会话档位（member.ai_mode）是用户显式选择，优先级最高；
 *   2. contact / schedule / global 策略的 mode 作为「会话未显式选择（仍为默认 manual）」时的兜底；
 *   3. 约束类字段（maxRisk / allowCapabilities / denyTopics / rateLimit）始终合并生效；
 *   4. 让位（主人在线且正在输入）、话题冷却、频率限制、日预算 → 直接降级/拒绝。
 */

import type { AvatarMode, PolicyRule, RiskLevel } from '@chappie/contract';
import { and, desc, eq } from 'drizzle-orm';
import type { Classification } from './classifier';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { aiKeys, redisExists, redisIncrWindow, redisSetEx } from './common/redis';
import { avatar as avatarTable, member, policy as policyTable } from './db/schema';
import { todayCost } from './model-gateway';
import { effectiveSessionMode } from './turn-guard';

export interface PolicyInput {
  avatarId: string;
  ownerId: string;
  conv: { id: string; type: string; systemTag: string | null };
  senderType: string;
  senderUserId: string | null;
  mentioned: boolean;
  via: 'mention' | 'direct' | 'auto' | 'self_chat';
  triggerMessageId: string;
  classification: Classification;
}

export interface PolicyEval {
  allow: boolean;
  mode: AvatarMode;
  reason: string;
  allowCapabilities: string[] | null;
  maxRisk: RiskLevel;
  rateLimitPerHour: number;
  /** 需要转交主人（禁区话题 / 低置信度等） */
  escalate: boolean;
  /** 通过策略评估但被降级（如预算超限） */
  downgraded: boolean;
}

function inScheduleWindow(rule: PolicyRule, now = dayjs()): boolean {
  const windows = rule.schedule ?? [];
  if (windows.length === 0) return true;
  const day = now.day() === 0 ? 7 : now.day(); // 1=周一 … 7=周日
  const minutes = now.hour() * 60 + now.minute();
  for (const w of windows) {
    if (w.days.length > 0 && !w.days.includes(day)) continue;
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (start <= end) {
      if (minutes >= start && minutes <= end) return true;
    } else {
      // 跨午夜，如 19:00-08:00
      if (minutes >= start || minutes <= end) return true;
    }
  }
  return false;
}

function deny(reason: string, mode: AvatarMode = 'off'): PolicyEval {
  return {
    allow: false,
    mode,
    reason,
    allowCapabilities: null,
    maxRisk: 'L1',
    rateLimitPerHour: 0,
    escalate: false,
    downgraded: false,
  };
}

export async function evaluatePolicy(p: PolicyInput): Promise<PolicyEval> {
  // 分身状态
  const avatarRows = await db
    .select({ id: avatarTable.id, status: avatarTable.status, budget: avatarTable.dailyBudgetUsd })
    .from(avatarTable)
    .where(eq(avatarTable.id, p.avatarId));
  const avatar = avatarRows[0];
  if (!avatar) return deny('分身不存在');
  if (avatar.status !== 'active') return deny('分身已被冻结');
  const budget = Number(avatar.budget);

  // 会话档位（member.ai_mode，含临时模式）
  const memberRows = await db
    .select({ aiMode: member.aiMode, aiModeUntil: member.aiModeUntil })
    .from(member)
    .where(and(eq(member.convId, p.conv.id), eq(member.principalId, p.ownerId)));
  const memberRow = memberRows[0];
  // 临时模式到期自动回落 manual；与 turn-guard 共用同一算法
  const sessionMode = effectiveSessionMode(memberRow?.aiMode, memberRow?.aiModeUntil);
  const sessionExplicit = sessionMode !== 'manual';

  // 策略（联系人 > 现场日程 > 全局）
  const policies = await db
    .select({
      id: policyTable.id,
      scopeType: policyTable.scopeType,
      scopeId: policyTable.scopeId,
      rule: policyTable.rule,
      priority: policyTable.priority,
    })
    .from(policyTable)
    .where(and(eq(policyTable.ownerId, p.ownerId), eq(policyTable.enabled, true)))
    .orderBy(desc(policyTable.priority));

  const contactPolicy = p.senderUserId
    ? policies.find((x) => x.scopeType === 'contact' && x.scopeId === p.senderUserId)
    : undefined;
  const schedulePolicy = policies.find(
    (x) => x.scopeType === 'schedule' && inScheduleWindow(x.rule),
  );
  const globalPolicy = policies.find((x) => x.scopeType === 'global');
  const overriding = contactPolicy ?? schedulePolicy ?? globalPolicy;

  // 合并档位
  let mode: AvatarMode = sessionMode;
  if (!sessionExplicit && overriding) mode = overriding.rule.mode;

  // 系统会话中的主人指令 = 显式 @，尊重会话档位（默认 manual 也允许）
  const isSelfChat = p.conv.systemTag === 'avatar_self';

  if (mode === 'off') return deny('档位：静默', mode);
  if (mode === 'manual' && !p.mentioned && !isSelfChat) {
    return deny('档位：手动（未被 @）', mode);
  }

  const maxRisk: RiskLevel = overriding?.rule.maxRisk ?? 'L1';
  const allowCapabilities = overriding?.rule.allowCapabilities ?? null;
  const rateLimitPerHour = overriding?.rule.rateLimitPerHour ?? 20;

  // 让位：主人正在输入（设计方案 §4.3）—— draft/auto 档时生效
  if (mode !== 'manual' && !isSelfChat) {
    const presence = await internal.getPresence([p.ownerId]).catch(() => []);
    const owner = presence[0];
    if (owner?.online && owner.typingConvId === p.conv.id) {
      return {
        ...deny('主人在线且正在输入，分身让位', mode),
        allow: false,
      };
    }
  }

  // 话题冷却（主人刚手动回复过的会话）
  if (await redisExists(aiKeys.cooldown(p.conv.id, p.ownerId))) {
    return deny('话题冷却中（主人刚介入过）', mode);
  }

  // 频率限制：按小时窗口
  const hourWindow = dayjs.utc().format('YYYY-MM-DDTHH'); // YYYY-MM-DDTHH
  const count = await redisIncrWindow(`${aiKeys.rate(p.avatarId)}:${hourWindow}`, 3600);
  if (count > rateLimitPerHour) {
    return deny(`超过频率限制（${rateLimitPerHour}/小时）`, mode);
  }

  // 日预算：超额降级为手动档并提示一次
  const cost = await todayCost(p.avatarId);
  let downgraded = false;
  let effectiveMode = mode;
  if (cost >= budget && mode !== 'manual') {
    downgraded = true;
    effectiveMode = 'manual';
    if (!p.mentioned && !isSelfChat) {
      return deny('日预算超限，已自动降为手动档', 'manual');
    }
    await maybeNotifyBudget(p.avatarId, p.ownerId, cost, budget);
  }

  // 禁区话题：不自动回复，转交主人
  const denyTopics = overriding?.rule.denyTopics ?? [];
  const hitTopic = p.classification.topics.find((t) => denyTopics.includes(t));
  if (hitTopic) {
    return {
      allow: false,
      mode: effectiveMode,
      reason: `命中禁区话题（${hitTopic}），转交主人`,
      allowCapabilities,
      maxRisk,
      rateLimitPerHour,
      escalate: true,
      downgraded,
    };
  }

  return {
    allow: true,
    mode: effectiveMode,
    reason: `档位 ${effectiveMode}${p.mentioned ? '（被 @）' : ''}`,
    allowCapabilities,
    maxRisk,
    rateLimitPerHour,
    escalate: false,
    downgraded,
  };
}

async function maybeNotifyBudget(avatarId: string, ownerId: string, cost: number, budget: number) {
  const day = dayjs.utc().format('YYYY-MM-DD');
  const key = aiKeys.budgetNotified(avatarId, day);
  if (await redisExists(key)) return;
  await redisSetEx(key, '1', 24 * 3600);
  await internal
    .pushCard(ownerId, {
      kind: 'handover',
      taskId: 'budget',
      summary: `今日分身花费 $${cost.toFixed(2)} 已达预算上限 $${budget.toFixed(2)}，自动档已降级为手动档。`,
      reason: '预算保护',
    })
    .catch(() => undefined);
}
