/**
 * 策略引擎 —— 设计方案 §4.2/§4.3/§27.3 第 3 步。
 *
 * 档位合并规则（实现约定，见 README）：
 *   1. 会话档位（member.ai_mode）是用户显式选择，优先级最高；
 *   2. contact / schedule / global 策略的 mode 作为「会话未显式选择（仍为默认 manual）」时的兜底；
 *   3. 约束类字段（maxRisk / allowCapabilities / denyTopics / rateLimit）始终合并生效；
 *   4. 让位（主人在线且正在输入）、话题冷却、频率限制、日预算 → 直接降级/拒绝。
 */

import type {
  AvatarMode,
  PolicyRule,
  ReceptionState,
  ReceptionStrategy,
  RiskLevel,
} from '@chappie/contract';
import { and, desc, eq } from 'drizzle-orm';
import type { Classification } from './classifier';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { aiKeys, redisExists, redisGet, redisIncrWindow, redisSetEx } from './common/redis';
import {
  avatar as avatarTable,
  contact,
  contactTagMember,
  conversationReception,
  member,
  policy as policyTable,
} from './db/schema';
import { todayCost } from './model-gateway';
import { effectiveSessionMode } from './turn-guard';

export interface PolicyInput {
  avatarId: string;
  ownerId: string;
  conv: { id: string; type: string; systemTag: string | null };
  senderType: string;
  senderUserId: string | null;
  mentioned: boolean;
  via: 'mention' | 'reply' | 'continuation' | 'direct' | 'auto' | 'self_chat';
  triggerMessageId: string;
  classification: Classification;
}

export interface PolicyEval {
  allow: boolean;
  mode: AvatarMode;
  authority: ReceptionState;
  strategy: ReceptionStrategy;
  /** AI 发送时必须回传，core 用它做版本围栏 */
  authorityVersion: number;
  reason: string;
  allowCapabilities: string[] | null;
  maxRisk: RiskLevel;
  rateLimitPerHour: number;
  /** 需要转交主人（禁区话题 / 低置信度等） */
  escalate: boolean;
  /** 通过策略评估但被降级（如预算超限） */
  downgraded: boolean;
  /** 紧急穿透：该联系人即使被筛选/静默也要提醒主人 */
  alwaysNotify: boolean;
}

function strategyToMode(strategy: ReceptionStrategy): AvatarMode {
  switch (strategy) {
    case 'full':
    case 'screen':
    case 'decline':
    case 'escalate':
    case 'silent':
      return 'auto';
    case 'assist':
      return 'draft';
    case 'off':
      return 'off';
    default:
      return 'manual';
  }
}

function modeToStrategy(mode: AvatarMode): ReceptionStrategy {
  switch (mode) {
    case 'auto':
      return 'full';
    case 'draft':
      return 'assist';
    case 'off':
      return 'off';
    default:
      return 'summon';
  }
}

function fallbackReception(mode: AvatarMode): {
  state: ReceptionState;
  strategy: ReceptionStrategy;
  version: number;
  until: string | null;
  source: string;
  counterpartyRequestable: boolean;
} {
  const strategy = modeToStrategy(mode);
  return {
    state: mode === 'auto' ? 'avatar' : 'human',
    strategy,
    version: 0,
    until: null,
    source: 'default',
    counterpartyRequestable: true,
  };
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

/** 解析简单升级条件：`confidence<0.7`、`confidence>=0.8` 等。 */
function matchesEscalate(rule: string, classification: Classification): boolean {
  const match = /^confidence\s*(<=|>=|<|>)\s*(0?\.\d+|1(?:\.0+)?)$/.exec(rule.trim());
  if (!match) return false;
  const threshold = Number(match[2]);
  const value = classification.confidence;
  switch (match[1]) {
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    default:
      return false;
  }
}

function deny(
  reason: string,
  mode: AvatarMode = 'off',
  authority: ReceptionState = 'human',
  strategy: ReceptionStrategy = 'off',
  authorityVersion = 0,
): PolicyEval {
  return {
    allow: false,
    mode,
    authority,
    strategy,
    authorityVersion,
    reason,
    allowCapabilities: null,
    maxRisk: 'L1',
    rateLimitPerHour: 0,
    escalate: false,
    downgraded: false,
    alwaysNotify: false,
  };
}

export async function evaluatePolicy(p: PolicyInput): Promise<PolicyEval> {
  // 分身状态
  const avatarRows = await db
    .select({
      id: avatarTable.id,
      status: avatarTable.status,
      budget: avatarTable.dailyBudgetUsd,
      trustLevel: avatarTable.trustLevel,
    })
    .from(avatarTable)
    .where(eq(avatarTable.id, p.avatarId));
  const avatar = avatarRows[0];
  if (!avatar) return deny('分身不存在');
  if (avatar.status !== 'active') return deny('分身已被冻结');
  const budget = Number(avatar.budget);

  // 会话档位（member.ai_mode，含临时模式）——仅作兜底
  const memberRows = await db
    .select({
      aiMode: member.aiMode,
      aiModeSource: member.aiModeSource,
      aiModeUntil: member.aiModeUntil,
    })
    .from(member)
    .where(and(eq(member.convId, p.conv.id), eq(member.principalId, p.ownerId)));
  const memberRow = memberRows[0];
  const sessionMode = effectiveSessionMode(memberRow?.aiMode, memberRow?.aiModeUntil);

  // 策略（会话 > 联系人 > 联系人分组 > 现场日程 > 全局）
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

  const tags = p.senderUserId
    ? (
        await db
          .select({ tag: contactTagMember.tag })
          .from(contactTagMember)
          .where(
            and(
              eq(contactTagMember.userId, p.ownerId),
              eq(contactTagMember.peerId, p.senderUserId),
            ),
          )
      ).map((r) => r.tag)
    : [];
  const alwaysNotify = p.senderUserId
    ? Boolean(
        (
          await db
            .select({ alwaysNotify: contact.alwaysNotify })
            .from(contact)
            .where(and(eq(contact.userId, p.ownerId), eq(contact.peerId, p.senderUserId)))
            .limit(1)
        )[0]?.alwaysNotify,
      )
    : false;

  const conversationPolicy = policies.find(
    (x) => x.scopeType === 'conversation' && x.scopeId === p.conv.id,
  );
  const contactPolicy = p.senderUserId
    ? policies.find((x) => x.scopeType === 'contact' && x.scopeId === p.senderUserId)
    : undefined;
  const groupPolicy = policies.find(
    (x) => x.scopeType === 'contact_group' && x.scopeId && tags.includes(x.scopeId),
  );
  const schedulePolicy = policies.find(
    (x) => x.scopeType === 'schedule' && inScheduleWindow(x.rule),
  );
  const globalPolicy = policies.find((x) => x.scopeType === 'global');
  const overriding =
    conversationPolicy ?? contactPolicy ?? groupPolicy ?? schedulePolicy ?? globalPolicy;

  // 接待态：以 core 的授权投影为准；失败时回落到会话档位/策略。
  const isSelfChat = p.conv.systemTag === 'avatar_self';
  let reception = fallbackReception(memberRow ? sessionMode : (overriding?.rule.mode ?? 'manual'));
  try {
    reception = await internal.getReception(p.conv.id, p.ownerId);
  } catch {
    const rows = await db
      .select()
      .from(conversationReception)
      .where(
        and(
          eq(conversationReception.convId, p.conv.id),
          eq(conversationReception.ownerId, p.ownerId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row) {
      reception = {
        state: row.state as ReceptionState,
        strategy: row.strategy as ReceptionStrategy,
        version: row.version,
        until: row.until ? new Date(row.until).toISOString() : null,
        source: row.source,
        counterpartyRequestable: true,
      };
    }
  }

  const authority = reception.state;
  let strategy = reception.strategy;
  // 策略只能细化分身接待时的行为；真人接待态由授权本身决定。
  if (authority === 'avatar' && overriding?.rule.strategy) {
    strategy = overriding.rule.strategy;
  }
  // 冷启动放权：低信任等级不能全权代答；L0 只观察，L1 强制草稿。
  if (!isSelfChat) {
    if (avatar.trustLevel <= 0) {
      strategy = 'silent';
    } else if (avatar.trustLevel <= 1 && strategy === 'full') {
      strategy = 'assist';
    }
  }
  if (isSelfChat && strategy === 'off') {
    strategy = 'summon';
  }
  const mode = strategyToMode(strategy);

  // 与自己的分身控制通道不依赖接待态：暂停/静默也应随时可下指令。
  if (authority === 'paused' && !isSelfChat) {
    return deny('接待态：已暂停', mode, authority, strategy, reception.version);
  }
  if (strategy === 'off' && !isSelfChat) {
    return deny('档位：静默', mode, authority, strategy, reception.version);
  }
  // 会话延续（reply / continuation）视作主人把对话交给分身；静默档仍然拒绝。
  const engaged = p.via === 'reply' || p.via === 'continuation';
  if (authority === 'human') {
    const canRespond =
      isSelfChat ||
      p.mentioned ||
      strategy === 'assist' ||
      (strategy === 'summon' && engaged) ||
      (strategy !== 'summon' && engaged);
    if (!canRespond) {
      return deny(
        '当前由真人接待（手动档：仅被 @ 或召唤时分身响应）',
        mode,
        authority,
        strategy,
        reception.version,
      );
    }
  }

  const maxRisk: RiskLevel = overriding?.rule.maxRisk ?? 'L1';
  const allowCapabilities = overriding?.rule.allowCapabilities ?? null;
  const rateLimitPerHour = overriding?.rule.rateLimitPerHour ?? 20;

  // 让位：主人正在输入（设计方案 §4.3）—— draft/auto 档时生效；
  // 显式 @ 是主人的直接指令，优先于让位。
  // 显式 @ 与直接回复优先于让位；会话延续仍会让位给正在输入的主人。
  if (mode !== 'manual' && !isSelfChat && !p.mentioned && p.via !== 'reply') {
    const presence = await internal.getPresence([p.ownerId]).catch(() => []);
    const owner = presence[0];
    if (owner?.online && owner.typingConvId === p.conv.id) {
      return {
        ...deny('主人在线且正在输入，分身让位', mode, authority, strategy, reception.version),
        allow: false,
      };
    }
  }

  // 话题冷却（主人刚手动回复过的会话）。
  // 显式 @ 是明确召唤，应该能唤醒分身，否则会出现「@ 了也不回」。
  if (!p.mentioned && (await redisExists(aiKeys.cooldown(p.conv.id, p.ownerId)))) {
    return deny('话题冷却中（主人刚介入过）', mode, authority, strategy, reception.version);
  }

  // 频率限制：按小时窗口。
  // - avatar_self 控制通道是主人显式指令，不占自动回复配额（限流针对分身对外代答）
  // - 只有实际放行的任务才计数：先读当前值判断，放行时再 INCR，被拒任务不烧配额
  const hourWindow = dayjs.utc().format('YYYY-MM-DDTHH'); // YYYY-MM-DDTHH
  const rateKey = `${aiKeys.rate(p.avatarId)}:${hourWindow}`;
  if (!isSelfChat) {
    const current = Number((await redisGet(rateKey)) ?? '0');
    if (current >= rateLimitPerHour) {
      return deny(
        `超过频率限制（${rateLimitPerHour}/小时）`,
        mode,
        authority,
        strategy,
        reception.version,
      );
    }
  }

  // 日预算：超额降级为手动档并提示一次
  const cost = await todayCost(p.avatarId);
  let downgraded = false;
  let effectiveMode = mode;
  if (cost >= budget && mode !== 'manual') {
    downgraded = true;
    effectiveMode = 'manual';
    if (!p.mentioned && !isSelfChat) {
      return deny('日预算超限，已自动降为手动档', 'manual', authority, strategy, reception.version);
    }
    await maybeNotifyBudget(p.avatarId, p.ownerId, cost, budget);
  }

  // 控制通道是主人对分身的直接指令：禁区/升级条件不应把消息“转交主人”。
  // 高风险工具仍由 tool-gateway 的 L2 审批与安全护栏兜底。
  if (!isSelfChat) {
    // 禁区话题：不自动回复，转交主人
    const denyTopics = overriding?.rule.denyTopics ?? [];
    const hitTopic = p.classification.topics.find((t) => denyTopics.includes(t));
    if (hitTopic) {
      return {
        allow: false,
        mode: effectiveMode,
        authority,
        strategy,
        authorityVersion: reception.version,
        reason: `命中禁区话题（${hitTopic}），转交主人`,
        allowCapabilities,
        maxRisk,
        rateLimitPerHour,
        escalate: true,
        downgraded,
        alwaysNotify,
      };
    }

    // 升级条件（如 confidence<0.7）：命中即转交主人，而不是自动回复
    const escalateRule = (overriding?.rule.escalateWhen ?? []).find((rule) =>
      matchesEscalate(rule, p.classification),
    );
    if (escalateRule) {
      return {
        allow: false,
        mode: effectiveMode,
        authority,
        strategy,
        authorityVersion: reception.version,
        reason: `命中升级条件（${escalateRule}），转交主人`,
        allowCapabilities,
        maxRisk,
        rateLimitPerHour,
        escalate: true,
        downgraded,
        alwaysNotify,
      };
    }
  }

  // 放行时才计入频率配额（Redis 不可用时 INCR 静默失败，按放行处理）
  if (!isSelfChat) await redisIncrWindow(rateKey, 3600);

  return {
    allow: true,
    mode: effectiveMode,
    authority,
    strategy,
    authorityVersion: reception.version,
    reason: `接待 ${authority}/${strategy}${
      p.mentioned
        ? '（被 @）'
        : p.via === 'reply'
          ? '（回复分身）'
          : p.via === 'continuation'
            ? '（会话延续）'
            : ''
    }`,
    allowCapabilities,
    maxRisk,
    rateLimitPerHour,
    escalate: false,
    downgraded,
    alwaysNotify,
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
