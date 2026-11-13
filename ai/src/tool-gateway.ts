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
import { dayjs } from './common/datetime';
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
  date: string | null;
  time: string;
}
interface TodoItem {
  text: string;
  done: boolean;
}

/**
 * 把模型给的自由格式时间文本（"tomorrow 14:00"、"明天 下午 3 点"、"2026-11-14 09:00"）
 * 解析成具体日期 + HH:mm。无法解析（如缺小时数）时返回 null，调用方按旧数据兜底展示。
 */
export function parseEventTime(input: string): { date: string; time: string } | null {
  const text = input.trim();
  if (!text) return null;

  const now = dayjs();

  // 事件时刻：小时[:分][点]，可带时段前缀（上午/下午/晚上/中午/早上）
  const timeMatch =
    /(上午|早上|凌晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})?\s*分?/.exec(text);
  if (!timeMatch) return null;
  const period = timeMatch[1];
  let hour = Number(timeMatch[2]);
  const minute = Number(timeMatch[3] ?? 0);
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  if ((period === '下午' || period === '傍晚' || period === '晚上') && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  // 具体日期：2026-11-14 / 2026/11/14 / 2026年11月14日
  const dateMatch = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/.exec(text);
  if (dateMatch) {
    const d = dayjs(
      `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`,
      'YYYY-MM-DD',
    );
    if (d.isValid()) return { date: d.format('YYYY-MM-DD'), time };
    return null;
  }

  // 相对日期词
  const weekDayMap: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
  };
  let day = now;
  if (/今天|今晚|today/i.test(text)) {
    day = now;
  } else if (/明天|明晚|tomorrow/i.test(text)) {
    day = now.add(1, 'day');
  } else if (/后天/.test(text)) {
    day = now.add(2, 'day');
  } else {
    const weekMatch = /(?:下周|星期|周)([一二三四五六日天])/.exec(text);
    if (weekMatch) {
      const target = weekDayMap[weekMatch[1]] ?? 1;
      let delta = (target - now.day() + 7) % 7;
      if (delta === 0) delta = 7; // 「下周三」说本周三时指向下周
      if (text.includes('下周') && now.day() !== 0 && target <= now.day()) delta += 7;
      day = now.add(delta, 'day');
    } else {
      day = now; // 只有时刻（如 "14:00"）默认今天
    }
  }
  return { date: day.format('YYYY-MM-DD'), time };
}

/** 归一化存储的日程条目：旧数据（无 date 字段）尽量解析补全 */
export function normalizeCalendarItem(raw: {
  title: string;
  time: string;
  date?: string | null;
}): CalendarItem {
  if (raw.date) return { title: raw.title, date: raw.date, time: raw.time };
  const parsed = parseEventTime(raw.time);
  if (parsed) return { title: raw.title, date: parsed.date, time: parsed.time };
  return { title: raw.title, date: null, time: raw.time };
}

/** 供 admin-api（日程/待办页）复用：读 avatar 级工具数据，无记录时返回 fallback */
export async function readToolData<T>(avatarId: string, kind: string, fallback: T): Promise<T> {
  const rows = await db
    .select({ data: toolData.data })
    .from(toolData)
    .where(and(eq(toolData.avatarId, avatarId), eq(toolData.kind, kind)));
  return rows.length ? ((rows[0].data as T) ?? fallback) : fallback;
}

export async function writeToolData(avatarId: string, kind: string, data: unknown): Promise<void> {
  await db
    .insert(toolData)
    .values({ avatarId, kind, data })
    .onConflictDoUpdate({
      target: [toolData.avatarId, toolData.kind],
      set: { data, updatedAt: sql`now()` },
    });
}

function todayCalendar(): CalendarItem[] {
  const today = dayjs().format('YYYY-MM-DD');
  return [
    { title: '产品评审会', date: today, time: '10:00' },
    { title: '与 Bob 的 1:1', date: today, time: '11:30' },
    { title: '健身', date: today, time: '19:00' },
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
      const day = String(_args.day ?? 'today') as 'today' | 'tomorrow' | 'week';
      const stored = (await readToolData<CalendarItem[]>(ctx.avatarId, 'calendar', todayCalendar()))
        .map(normalizeCalendarItem);
      const today = dayjs();
      const matchDay = (item: CalendarItem): boolean => {
        if (!item.date) return day === 'today'; // 无法解析的旧数据只在「今天」里兜底展示
        if (day === 'today') return item.date === today.format('YYYY-MM-DD');
        if (day === 'tomorrow') return item.date === today.add(1, 'day').format('YYYY-MM-DD');
        const diff = dayjs(item.date, 'YYYY-MM-DD').startOf('day').diff(today.startOf('day'), 'day');
        return diff >= 0 && diff < 7;
      };
      const items = stored
        .filter(matchDay)
        .slice(0, 8)
        .map((x) => (x.date ? `${x.date} ${x.time} ${x.title}` : `${x.time} ${x.title}`));
      const label = day === 'today' ? '今天' : day === 'tomorrow' ? '明天' : '未来一周';
      return {
        summary:
          items.length === 0
            ? `日程是空的，${label}没有安排。`
            : `${label}共有 ${items.length} 项安排：${items.join('；')}`,
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
        time: {
          type: 'string',
          description: '时间，如 "明天 15:00"、"2026-11-14 09:30"、"tomorrow 10:00"',
        },
      },
    },
    validate: z.object({
      title: z.string().min(1).max(100),
      time: z.string().default('明天 10:00'),
    }),
    async exec(args, ctx) {
      const title = String(args.title);
      const timeInput = String(args.time ?? '明天 10:00');
      const parsed = parseEventTime(timeInput);
      const stored = await readToolData<CalendarItem[]>(ctx.avatarId, 'calendar', []);
      stored.push(
        parsed
          ? { title, date: parsed.date, time: parsed.time }
          : { title, date: null, time: timeInput },
      );
      await writeToolData(ctx.avatarId, 'calendar', stored);
      const when = parsed ? `${parsed.date} ${parsed.time}` : timeInput;
      return {
        ok: true,
        message: `已创建日程：${when} ${title}`,
        summary: `已帮你创建日程「${title}」（${when}）✅`,
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
    id: 'calendar.update',
    name: '修改日程',
    description: '修改一条已有日程的标题或时间（低风险写操作）',
    risk: 'L1',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['match'],
      properties: {
        match: { type: 'string', description: '要修改的日程标题（完整或包含关键词）' },
        newTitle: { type: 'string', description: '新标题，不修改则不传' },
        newTime: { type: 'string', description: '新时间，如 "明天 15:00"，不修改则不传' },
      },
    },
    validate: z.object({
      match: z.string().min(1).max(100),
      newTitle: z.string().min(1).max(100).optional(),
      newTime: z.string().min(1).max(60).optional(),
    }),
    async exec(args, ctx) {
      const match = String(args.match).trim();
      const stored = (await readToolData<CalendarItem[]>(ctx.avatarId, 'calendar', [])).map(
        normalizeCalendarItem,
      );
      const hits = stored.filter((x) => x.title.includes(match));
      if (hits.length === 0) {
        return { ok: false, summary: `没找到标题包含「${match}」的日程，请确认后再试。` };
      }
      if (hits.length > 1) {
        const list = hits.map((x) => `${x.date ?? ''} ${x.time} ${x.title}`).join('；');
        return {
          ok: false,
          summary: `找到 ${hits.length} 条匹配「${match}」的日程（${list}），请说得更具体一些。`,
        };
      }
      const index = stored.findIndex((x) => x.title.includes(match));
      const item = stored[index]!;
      const before = `${item.date ?? ''} ${item.time} ${item.title}`.trim();
      if (args.newTitle !== undefined) item.title = String(args.newTitle);
      if (args.newTime !== undefined) {
        const parsed = parseEventTime(String(args.newTime));
        if (!parsed) {
          return { ok: false, summary: `新时间「${String(args.newTime)}」无法识别，请换种说法。` };
        }
        item.date = parsed.date;
        item.time = parsed.time;
      }
      stored[index] = item;
      await writeToolData(ctx.avatarId, 'calendar', stored);
      const after = `${item.date ?? ''} ${item.time} ${item.title}`.trim();
      return {
        ok: true,
        summary: `已修改日程：${before} → ${after}`,
      };
    },
  },
  {
    id: 'calendar.delete',
    name: '删除日程',
    description: '删除一条日程（高风险，需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['match'],
      properties: {
        match: { type: 'string', description: '要删除的日程标题（完整或包含关键词）' },
      },
    },
    validate: z.object({ match: z.string().min(1).max(100) }),
    async exec(args, ctx) {
      const match = String(args.match).trim();
      const stored = (await readToolData<CalendarItem[]>(ctx.avatarId, 'calendar', [])).map(
        normalizeCalendarItem,
      );
      const hits = stored.filter((x) => x.title.includes(match));
      if (hits.length === 0) {
        return { ok: false, summary: `没找到标题包含「${match}」的日程，无需删除。` };
      }
      if (hits.length > 1) {
        const list = hits.map((x) => `${x.date ?? ''} ${x.time} ${x.title}`).join('；');
        return {
          ok: false,
          summary: `找到 ${hits.length} 条匹配「${match}」的日程（${list}），请说得更具体一些。`,
        };
      }
      const index = stored.findIndex((x) => x.title.includes(match));
      const removed = stored.splice(index, 1)[0]!;
      await writeToolData(ctx.avatarId, 'calendar', stored);
      const when = `${removed.date ?? ''} ${removed.time}`.trim();
      return {
        ok: true,
        summary: `已删除日程：${when} ${removed.title}`,
      };
    },
  },
  {
    id: 'todo.update',
    name: '修改待办',
    description: '修改一条待办的内容或完成状态（低风险写操作）',
    risk: 'L1',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['match'],
      properties: {
        match: { type: 'string', description: '要修改的待办内容（完整或包含关键词）' },
        newText: { type: 'string', description: '新内容，不修改则不传' },
        done: { type: 'boolean', description: '完成状态，不修改则不传' },
      },
    },
    validate: z.object({
      match: z.string().min(1).max(200),
      newText: z.string().min(1).max(200).optional(),
      done: z.boolean().optional(),
    }),
    async exec(args, ctx) {
      const match = String(args.match).trim();
      const items = await readToolData<TodoItem[]>(ctx.avatarId, 'todo', []);
      const hits = items.filter((x) => x.text.includes(match));
      if (hits.length === 0) {
        return { ok: false, summary: `没找到内容包含「${match}」的待办。` };
      }
      if (hits.length > 1) {
        return {
          ok: false,
          summary: `找到 ${hits.length} 条匹配「${match}」的待办（${hits.map((x) => x.text).join('；')}），请说得更具体一些。`,
        };
      }
      const index = items.findIndex((x) => x.text.includes(match));
      const before = `${items[index]!.done ? '[已完成] ' : ''}${items[index]!.text}`;
      if (args.newText !== undefined) items[index]!.text = String(args.newText);
      if (args.done !== undefined) items[index]!.done = Boolean(args.done);
      await writeToolData(ctx.avatarId, 'todo', items);
      const after = `${items[index]!.done ? '[已完成] ' : ''}${items[index]!.text}`;
      return { ok: true, summary: `已修改待办：${before} → ${after}` };
    },
  },
  {
    id: 'todo.delete',
    name: '删除待办',
    description: '删除一条待办（高风险，需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['match'],
      properties: {
        match: { type: 'string', description: '要删除的待办内容（完整或包含关键词）' },
      },
    },
    validate: z.object({ match: z.string().min(1).max(200) }),
    async exec(args, ctx) {
      const match = String(args.match).trim();
      const items = await readToolData<TodoItem[]>(ctx.avatarId, 'todo', []);
      const hits = items.filter((x) => x.text.includes(match));
      if (hits.length === 0) {
        return { ok: false, summary: `没找到内容包含「${match}」的待办，无需删除。` };
      }
      if (hits.length > 1) {
        return {
          ok: false,
          summary: `找到 ${hits.length} 条匹配「${match}」的待办（${hits.map((x) => x.text).join('；')}），请说得更具体一些。`,
        };
      }
      const index = items.findIndex((x) => x.text.includes(match));
      const removed = items.splice(index, 1)[0]!;
      await writeToolData(ctx.avatarId, 'todo', items);
      return { ok: true, summary: `已删除待办：${removed.text}` };
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
