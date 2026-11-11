/**
 * 工具网关 —— 设计方案 §8：能力注册、参数校验、风险分级、授权、审计。
 *
 * 风险处理（§8.2）：
 *   L0 只读 → 直接执行
 *   L1 低风险写 → 执行并记录
 *   L2 高风险 → 必须主人确认（创建 approval + 确认卡片）
 *   L3 禁止 → 永不自动，直接拒绝
 * 策略 maxRisk 限制「可自动执行」的上限：L0/L1 超出上限 → 拒绝。
 */

import type { RiskLevel } from '@chappie/contract';
import { and, eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from './common/db';
import { capabilityGrant, toolData } from './db/schema';
import { complete } from './model-gateway';

const RISK_ORDER: Record<RiskLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

export interface ToolContext {
  avatarId: string;
  ownerId: string;
  taskId: string;
  traceId: string;
}

export interface BuiltinTool {
  id: string;
  name: string;
  description: string;
  risk: RiskLevel;
  /** 是否幂等（设计方案 §27.5「能力声明是否幂等」）：崩溃恢复时，非幂等工具不确定状态一律保守转人工 */
  idempotent: boolean;
  /** 参数 JSON Schema（下发给模型的 tool 定义） */
  jsonSchema: Record<string, unknown>;
  validate: z.ZodTypeAny;
  exec: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// 演示数据（生产中这些工具对接真实系统，经 MCP / OAuth 授权 —— §8.3/§8.4）
// ---------------------------------------------------------------------------

interface CalendarItem {
  title: string;
  time: string;
}
interface TodoItem {
  text: string;
  done: boolean;
}

async function readToolData<T>(avatarId: string, kind: string, fallback: T): Promise<T> {
  const rows = await db
    .select({ data: toolData.data })
    .from(toolData)
    .where(and(eq(toolData.avatarId, avatarId), eq(toolData.kind, kind)));
  return rows.length ? ((rows[0].data as T) ?? fallback) : fallback;
}

async function writeToolData(avatarId: string, kind: string, data: unknown): Promise<void> {
  await db
    .insert(toolData)
    .values({ avatarId, kind, data })
    .onConflictDoUpdate({
      target: [toolData.avatarId, toolData.kind],
      set: { data, updatedAt: sql`now()` },
    });
}

function todayCalendar(): CalendarItem[] {
  return [
    { title: '产品评审会', time: '10:00' },
    { title: '与 Bob 的 1:1', time: '11:30' },
    { title: '健身', time: '19:00' },
  ];
}

async function callModelText(system: string, user: string): Promise<string> {
  const result = await complete({
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.3,
    maxTokens: 512,
  });
  return result.text || '（模型未返回内容）';
}

// ---------------------------------------------------------------------------
// 内置工具注册表
// ---------------------------------------------------------------------------

export const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    id: 'calendar.read',
    name: '查询日程',
    description: '查询日程安排，可指定今天/明天',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      properties: {
        day: { type: 'string', enum: ['today', 'tomorrow', 'week'], description: '查询范围' },
      },
    },
    validate: z.object({ day: z.enum(['today', 'tomorrow', 'week']).default('today') }),
    async exec(_args, ctx) {
      const stored = await readToolData<CalendarItem[]>(ctx.avatarId, 'calendar', todayCalendar());
      const items = stored.slice(0, 8).map((x) => `${x.time} ${x.title}`);
      return {
        summary:
          items.length === 0
            ? '日程是空的，今天没有安排。'
            : `今天共有 ${items.length} 项安排：${items.join('；')}`,
        items,
      };
    },
  },
  {
    id: 'calendar.create',
    name: '创建日程',
    description: '创建一条日程提醒（低风险写操作）',
    risk: 'L1',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: '日程标题' },
        time: { type: 'string', description: '时间，如 tomorrow 10:00' },
      },
    },
    validate: z.object({
      title: z.string().min(1).max(100),
      time: z.string().default('tomorrow 10:00'),
    }),
    async exec(args, ctx) {
      const title = String(args.title);
      const time = String(args.time ?? 'tomorrow 10:00');
      const stored = await readToolData<CalendarItem[]>(ctx.avatarId, 'calendar', todayCalendar());
      stored.push({ title, time });
      await writeToolData(ctx.avatarId, 'calendar', stored);
      return {
        ok: true,
        message: `已创建日程：${time} ${title}`,
        summary: `已帮你创建日程「${title}」（${time}）✅`,
      };
    },
  },
  {
    id: 'todo.list',
    name: '查看待办',
    description: '查看当前待办清单',
    risk: 'L0',
    idempotent: true,
    jsonSchema: { type: 'object', properties: {} },
    validate: z.object({}),
    async exec(_args, ctx) {
      const items = await readToolData<TodoItem[]>(ctx.avatarId, 'todo', []);
      const pending = items.filter((i) => !i.done).map((i) => i.text);
      return {
        summary: pending.length
          ? `待办有 ${pending.length} 项：${pending.join('；')}`
          : '待办清单是空的。',
        items: pending,
      };
    },
  },
  {
    id: 'todo.add',
    name: '添加待办',
    description: '向待办清单添加一项',
    risk: 'L1',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    validate: z.object({ text: z.string().min(1).max(200) }),
    async exec(args, ctx) {
      const items = await readToolData<TodoItem[]>(ctx.avatarId, 'todo', []);
      items.push({ text: String(args.text), done: false });
      await writeToolData(ctx.avatarId, 'todo', items);
      return { ok: true, summary: `已加入待办：${String(args.text)}` };
    },
  },
  {
    id: 'translate',
    name: '翻译',
    description: '把文本翻译为目标语言（默认英文）',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        targetLang: { type: 'string', default: 'en' },
      },
    },
    validate: z.object({ text: z.string().min(1).max(2000), targetLang: z.string().default('en') }),
    async exec(args) {
      const translated = await callModelText(
        '你是专业翻译。只输出译文，不要解释。',
        `把下面内容翻译成 ${String(args.targetLang)}：\n${String(args.text).slice(0, 500)}`,
      );
      return { summary: `翻译结果：${translated}`, translated };
    },
  },
  {
    id: 'summarize',
    name: '总结',
    description: '总结一段文本的要点',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
    validate: z.object({ text: z.string().min(1).max(4000) }),
    async exec(args) {
      const summary = await callModelText(
        '你是简洁的会议纪要助手，输出 3 条以内要点。',
        String(args.text).slice(0, 2000),
      );
      return { summary: `总结：${summary}`, text: summary };
    },
  },
  {
    id: 'web.search',
    name: '搜索',
    description: '在网络上搜索信息（演示实现返回模拟结果）',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } },
    },
    validate: z.object({ query: z.string().min(1).max(200) }),
    async exec(args) {
      const q = String(args.query);
      return {
        summary: `搜到 3 条与「${q}」相关的信息（演示数据）：1) 概念综述；2) 实践指南；3) 最新动态。`,
        items: [`${q} 概念综述`, `${q} 实践指南`, `${q} 最新动态`],
      };
    },
  },
  {
    id: 'payment.send',
    name: '发起转账',
    description: '给他人转账（高风险，需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['amount'],
      properties: {
        amount: { type: 'number', description: '金额（元）' },
        currency: { type: 'string', default: 'CNY' },
        note: { type: 'string' },
      },
    },
    validate: z.object({
      amount: z.number().positive(),
      currency: z.string().default('CNY'),
      note: z.string().optional(),
    }),
    async exec(args) {
      const txId = `tx_${uuidv4().slice(0, 8)}`;
      return {
        ok: true,
        transactionId: txId,
        summary: `已代你向对方转账 ¥${Number(args.amount)}（演示交易 ${txId}），请留意到账通知。`,
      };
    },
  },
];

export function getTool(id: string): BuiltinTool | undefined {
  return BUILTIN_TOOLS.find((t) => t.id === id);
}

/** 能力清单（供控制台展示） */
export function listCapabilities(): {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  schema: Record<string, unknown>;
}[] {
  return BUILTIN_TOOLS.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    riskLevel: t.risk,
    schema: t.jsonSchema,
  }));
}

// ---------------------------------------------------------------------------
// 权限与风险检查
// ---------------------------------------------------------------------------

export type ToolDecision =
  | { status: 'ok'; tool: BuiltinTool; args: Record<string, unknown> }
  | { status: 'need_approval'; tool: BuiltinTool; args: Record<string, unknown> }
  | { status: 'denied'; reason: string };

export async function prepareToolCall(params: {
  avatarId: string;
  toolId: string;
  rawArgs: Record<string, unknown>;
  policyAllowCapabilities: string[] | null;
  maxRisk: RiskLevel;
}): Promise<ToolDecision> {
  const tool = getTool(params.toolId);
  if (!tool) return { status: 'denied', reason: `未知能力: ${params.toolId}` };

  // 授权检查（capability_grant）
  const grantRows = await db
    .select({ granted: capabilityGrant.granted })
    .from(capabilityGrant)
    .where(
      and(
        eq(capabilityGrant.avatarId, params.avatarId),
        eq(capabilityGrant.capabilityId, params.toolId),
      ),
    );
  const granted = grantRows[0]?.granted ?? false;
  if (!granted) return { status: 'denied', reason: `能力未授权: ${tool.name}` };

  // 策略白名单
  if (params.policyAllowCapabilities && !params.policyAllowCapabilities.includes(tool.id)) {
    return { status: 'denied', reason: `策略未允许能力: ${tool.name}` };
  }

  // L3 永不自动
  if (tool.risk === 'L3') return { status: 'denied', reason: 'L3 能力禁止自动执行' };

  // 参数校验
  const parsed = tool.validate.safeParse(params.rawArgs ?? {});
  if (!parsed.success) {
    return { status: 'denied', reason: `参数不合法: ${parsed.error.message.slice(0, 200)}` };
  }
  const args = parsed.data as Record<string, unknown>;

  // L2 强制审批（无论 maxRisk）
  if (tool.risk === 'L2') return { status: 'need_approval', tool, args };

  // L0/L1 超过策略 maxRisk → 拒绝
  if (RISK_ORDER[tool.risk] > RISK_ORDER[params.maxRisk]) {
    return {
      status: 'denied',
      reason: `策略限制 maxRisk=${params.maxRisk}，${tool.name}（${tool.risk}）不可自动执行`,
    };
  }

  return { status: 'ok', tool, args };
}

export async function executeTool(
  tool: BuiltinTool,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  return tool.exec(args, ctx);
}
