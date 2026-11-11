/**
 * 控制台 API —— 设计方案 §12 / §27.1 admin-api：
 * 分身人设、策略、能力授权、记忆治理、任务回放、审批、用量、日报。
 * 鉴权：Bearer 用户 token（经 im-core 内部 verify-token 校验），数据按 userId 隔离。
 */

import type {
  AgentTask,
  Approval,
  Avatar,
  CapabilityGrant,
  DailyReport,
  Policy,
  PolicyRule,
  UsageDay,
} from '@chappie/contract';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './common/config';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { internal } from './common/internal';
import { log, newId } from './common/log';
import {
  agentTask,
  approval as approvalTable,
  avatar as avatarTable,
  capability,
  capabilityGrant,
  dailyReport,
  memoryItem,
  policy as policyTable,
  styleProfile,
  taskStep,
  usageDaily,
} from './db/schema';
import { deleteMemory, forgetTopic, listMemories } from './memory';
import { complete, recordUsage, todayCost } from './model-gateway';
import { generateDailyReport } from './scheduler';
import { listCapabilities } from './tool-gateway';

type Env = { Variables: { userId: string } };

const err = (code: string, message: string) => ({ error: { code, message } });

type AvatarRow = typeof avatarTable.$inferSelect;

function avatarApi(r: AvatarRow): Avatar {
  return {
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    persona: r.persona,
    modelProfile: r.modelProfile,
    status: r.status as Avatar['status'],
    selfConvId: r.selfConvId,
    dailyBudgetUsd: Number(r.dailyBudgetUsd),
    version: r.version,
  };
}

async function getAvatar(ownerId: string): Promise<AvatarRow | null> {
  const rows = await db.select().from(avatarTable).where(eq(avatarTable.ownerId, ownerId)).limit(1);
  return rows[0] ?? null;
}

function policyApi(r: typeof policyTable.$inferSelect): Policy {
  return {
    id: r.id,
    ownerId: r.ownerId,
    scopeType: r.scopeType as Policy['scopeType'],
    scopeId: r.scopeId,
    name: r.name,
    rule: r.rule,
    priority: r.priority,
    enabled: r.enabled,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function taskApi(r: typeof agentTask.$inferSelect): AgentTask {
  return {
    id: r.id,
    avatarId: r.avatarId,
    ownerId: r.ownerId,
    triggerMsgId: r.triggerMsgId,
    triggerConvId: r.triggerConvId,
    triggerKind: r.triggerKind,
    status: r.status as AgentTask['status'],
    result: r.result,
    decision: r.decision,
    costUsd: Number(r.costUsd),
    tokensUsed: r.tokensUsed,
    traceId: r.traceId,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function approvalApi(r: typeof approvalTable.$inferSelect): Approval {
  return {
    id: r.id,
    taskId: r.taskId,
    avatarId: r.avatarId,
    approver: r.approver,
    title: r.title,
    toolName: r.toolName,
    args: r.args,
    status: r.status as Approval['status'],
    cardMsgId: r.cardMsgId,
    expiresAt: r.expiresAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export function createAdminApp() {
  const app = new Hono<Env>();

  app.use('*', cors());
  app.use('/admin/v1/*', async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return c.json(err('unauthorized', '缺少 Bearer 令牌'), 401);
    try {
      const { userId } = await internal.verifyToken(token);
      c.set('userId', userId);
    } catch {
      return c.json(err('unauthorized', '登录已过期，请重新登录'), 401);
    }
    return next();
  });

  app.get('/health', (c) => c.json({ ok: true, service: 'ai-platform-admin' }));

  /** 统一取 avatar；未就绪时返回 409 avatar_not_ready（user.created 事件异步创建） */
  const requireAvatar = async (c: { get: (k: 'userId') => string }) => {
    const avatar = await getAvatar(c.get('userId'));
    return avatar;
  };

  // ---------------- 分身 ----------------

  app.get('/admin/v1/avatar', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化，请稍后刷新'), 409);
    const styleRows = await db
      .select()
      .from(styleProfile)
      .where(eq(styleProfile.avatarId, avatar.id))
      .limit(1);
    return c.json({
      avatar: avatarApi(avatar),
      style: styleRows[0]
        ? {
            avatarId: avatar.id,
            features: styleRows[0].features,
            examples: styleRows[0].examples,
            updatedAt: dayjs(styleRows[0].updatedAt).toISOString(),
          }
        : null,
    });
  });

  app.patch('/admin/v1/avatar', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      persona?: string;
      dailyBudgetUsd?: number;
    };
    await db
      .update(avatarTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.persona !== undefined ? { persona: body.persona } : {}),
        ...(body.dailyBudgetUsd !== undefined
          ? { dailyBudgetUsd: String(body.dailyBudgetUsd) }
          : {}),
        version: sql`${avatarTable.version} + 1`,
      })
      .where(eq(avatarTable.id, avatar.id));
    const updated = await getAvatar(avatar.ownerId);
    return c.json({ avatar: avatarApi(updated!) });
  });

  /** 风格预览：输入一句话，看分身会怎么回（设计方案 §12） */
  app.post('/admin/v1/avatar/preview', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const body = (await c.req.json().catch(() => ({}))) as { text?: string };
    if (!body.text?.trim()) return c.json(err('bad_request', '缺少 text'), 400);

    const result = await complete({
      system: `${avatar.persona}\n\n你现在只是在做风格预览：请以你的口吻直接回复用户这句话，不需要说明自己是 AI。`,
      messages: [{ role: 'user', content: body.text.trim() }],
      temperature: 0.8,
      maxTokens: 300,
      mockHints: { ownerName: avatar.name.replace(/\s*的分身$/, ''), persona: avatar.persona },
    });
    await recordUsage(avatar.id, result).catch(() => undefined);
    return c.json({ reply: result.text, usedProvider: result.provider });
  });

  app.post('/admin/v1/avatar/freeze', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const body = (await c.req.json().catch(() => ({}))) as { frozen?: boolean };
    const frozen = Boolean(body.frozen);
    await internal.freezeAvatar(avatar.id, frozen);
    await db
      .update(avatarTable)
      .set({
        status: frozen ? 'frozen' : 'active',
        version: sql`${avatarTable.version} + 1`,
      })
      .where(eq(avatarTable.id, avatar.id));
    return c.json({ ok: true, frozen });
  });

  // ---------------- 策略 ----------------

  app.get('/admin/v1/policies', async (c) => {
    const userId = c.get('userId');
    const rows = await db
      .select()
      .from(policyTable)
      .where(eq(policyTable.ownerId, userId))
      .orderBy(desc(policyTable.priority), asc(policyTable.createdAt));
    return c.json({ policies: rows.map(policyApi) });
  });

  app.post('/admin/v1/policies', async (c) => {
    const userId = c.get('userId');
    const body = (await c.req.json().catch(() => ({}))) as {
      scopeType?: string;
      scopeId?: string | null;
      name?: string;
      rule?: PolicyRule;
    };
    const allowed = ['global', 'contact', 'contact_group', 'conversation', 'schedule'];
    if (!body.scopeType || !allowed.includes(body.scopeType)) {
      return c.json(err('bad_request', 'scopeType 不合法'), 400);
    }
    if (!body.rule?.mode) return c.json(err('bad_request', '缺少 rule.mode'), 400);
    const id = newId('p');
    const rows = await db
      .insert(policyTable)
      .values({
        id,
        ownerId: userId,
        scopeType: body.scopeType,
        scopeId: body.scopeId ?? null,
        name: body.name ?? '',
        rule: body.rule,
        priority: 0,
      })
      .returning();
    return c.json({ policy: policyApi(rows[0]) }, 201);
  });

  app.patch('/admin/v1/policies/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      rule?: PolicyRule;
      enabled?: boolean;
    };
    const rows = await db
      .update(policyTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.rule !== undefined ? { rule: body.rule } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        version: sql`${policyTable.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(policyTable.id, id), eq(policyTable.ownerId, userId)))
      .returning();
    if (rows.length === 0) return c.json(err('not_found', '策略不存在'), 404);
    return c.json({ policy: policyApi(rows[0]) });
  });

  app.delete('/admin/v1/policies/:id', async (c) => {
    const userId = c.get('userId');
    const rows = await db
      .delete(policyTable)
      .where(and(eq(policyTable.id, c.req.param('id')), eq(policyTable.ownerId, userId)))
      .returning({ id: policyTable.id });
    if (rows.length === 0) return c.json(err('not_found', '策略不存在'), 404);
    return c.json({ ok: true });
  });

  // ---------------- 能力授权 ----------------

  app.get('/admin/v1/capabilities', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const grants = await db
      .select({
        capabilityId: capabilityGrant.capabilityId,
        granted: capabilityGrant.granted,
        constraints: capabilityGrant.constraints,
      })
      .from(capabilityGrant)
      .where(eq(capabilityGrant.avatarId, avatar.id));
    const grantMap = new Map(grants.map((g) => [g.capabilityId, g]));
    const caps = listCapabilities().map((cap) => ({
      capability: {
        id: cap.id,
        name: cap.name,
        description: cap.description,
        riskLevel: cap.riskLevel,
        provider: 'builtin',
        version: 1,
        schema: cap.schema,
      },
      grant: {
        capabilityId: cap.id,
        granted: grantMap.get(cap.id)?.granted ?? false,
        constraints: grantMap.get(cap.id)?.constraints ?? {},
      } satisfies CapabilityGrant,
    }));
    return c.json({ capabilities: caps });
  });

  app.put('/admin/v1/capabilities/:id/grant', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const body = (await c.req.json().catch(() => ({}))) as {
      granted?: boolean;
      constraints?: Record<string, unknown>;
    };
    const capId = c.req.param('id');
    const exists = await db
      .select({ id: capability.id })
      .from(capability)
      .where(eq(capability.id, capId));
    if (exists.length === 0) return c.json(err('not_found', '能力不存在'), 404);
    await db
      .insert(capabilityGrant)
      .values({
        avatarId: avatar.id,
        capabilityId: capId,
        granted: Boolean(body.granted),
        constraints: body.constraints ?? {},
      })
      .onConflictDoUpdate({
        target: [capabilityGrant.avatarId, capabilityGrant.capabilityId],
        set: {
          granted: Boolean(body.granted),
          constraints: body.constraints ?? {},
          updatedAt: sql`now()`,
        },
      });
    return c.json({ ok: true });
  });

  // ---------------- 记忆 ----------------

  app.get('/admin/v1/memories', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const scope = (c.req.query('scope') ?? 'all') as 'all' | 'global' | 'contact';
    const peerId = c.req.query('peerId') ?? undefined;
    const memories = await listMemories(avatar.id, scope, peerId);
    return c.json({ memories });
  });

  app.patch('/admin/v1/memories/:id', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const body = (await c.req.json().catch(() => ({}))) as {
      content?: string;
      sensitivity?: 'normal' | 'sensitive';
    };
    const patch: Partial<typeof memoryItem.$inferInsert> = {};
    if (body.content !== undefined) patch.content = body.content;
    if (body.sensitivity !== undefined) patch.sensitivity = body.sensitivity;
    const rows = await db
      .update(memoryItem)
      .set(patch)
      .where(and(eq(memoryItem.id, c.req.param('id')), eq(memoryItem.avatarId, avatar.id)))
      .returning({ id: memoryItem.id });
    if (rows.length === 0) return c.json(err('not_found', '记忆不存在'), 404);
    return c.json({ ok: true });
  });

  app.delete('/admin/v1/memories/:id', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const ok = await deleteMemory(avatar.id, c.req.param('id'), c.get('userId'));
    if (!ok) return c.json(err('not_found', '记忆不存在'), 404);
    return c.json({ ok: true });
  });

  /** 忘记这件事 / 这个主题（设计方案 §9.2） */
  app.post('/admin/v1/memories/forget-topic', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const body = (await c.req.json().catch(() => ({}))) as { keyword?: string };
    if (!body.keyword?.trim()) return c.json(err('bad_request', '缺少 keyword'), 400);
    const deleted = await forgetTopic(avatar.id, body.keyword.trim());
    return c.json({ ok: true, deleted });
  });

  // ---------------- 任务 / 审批 ----------------

  app.get('/admin/v1/tasks', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const status = c.req.query('status');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const rows = await db
      .select()
      .from(agentTask)
      .where(
        and(eq(agentTask.avatarId, avatar.id), status ? eq(agentTask.status, status) : sql`true`),
      )
      .orderBy(desc(agentTask.createdAt))
      .limit(limit);
    return c.json({ tasks: rows.map(taskApi) });
  });

  app.get('/admin/v1/tasks/:id', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const rows = await db
      .select()
      .from(agentTask)
      .where(and(eq(agentTask.id, c.req.param('id')), eq(agentTask.avatarId, avatar.id)));
    if (rows.length === 0) return c.json(err('not_found', '任务不存在'), 404);
    const stepRows = await db
      .select()
      .from(taskStep)
      .where(eq(taskStep.taskId, c.req.param('id')))
      .orderBy(asc(taskStep.idx));
    return c.json({
      task: taskApi(rows[0]),
      steps: stepRows.map((s) => ({
        id: s.id,
        taskId: s.taskId,
        idx: s.idx,
        type: s.type,
        input: s.input ?? null,
        output: s.output ?? null,
        model: s.model,
        tokens: s.tokens,
        latencyMs: s.latencyMs,
        createdAt: dayjs(s.createdAt).toISOString(),
      })),
    });
  });

  app.get('/admin/v1/approvals', async (c) => {
    const userId = c.get('userId');
    const status = c.req.query('status');
    const rows = await db
      .select()
      .from(approvalTable)
      .where(
        and(
          eq(approvalTable.approver, userId),
          status ? eq(approvalTable.status, status as Approval['status']) : sql`true`,
        ),
      )
      .orderBy(desc(approvalTable.createdAt))
      .limit(100);
    return c.json({ approvals: rows.map(approvalApi) });
  });

  // ---------------- 用量 / 日报 ----------------

  app.get('/admin/v1/usage', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const days = Math.min(Number(c.req.query('days') ?? 14), 90);
    const rows = await db
      .select({
        day: sql<string>`${usageDaily.day}::text`,
        provider: usageDaily.provider,
        model: usageDaily.model,
        requests: usageDaily.requests,
        inputTokens: usageDaily.inputTokens,
        outputTokens: usageDaily.outputTokens,
        costUsd: sql<number>`${usageDaily.costUsd}::float8`,
      })
      .from(usageDaily)
      .where(
        and(
          eq(usageDaily.avatarId, avatar.id),
          sql`${usageDaily.day} >= CURRENT_DATE - ${days}::int`,
        ),
      )
      .orderBy(desc(usageDaily.day));
    const usage: UsageDay[] = rows.map((r) => ({
      day: r.day,
      provider: r.provider,
      model: r.model,
      requests: Number(r.requests),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: Number(r.costUsd),
    }));
    return c.json({
      usage,
      todayCostUsd: await todayCost(avatar.id),
      dailyBudgetUsd: Number(avatar.dailyBudgetUsd),
    });
  });

  app.get('/admin/v1/reports/daily', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const date = c.req.query('date') ?? dayjs.utc().format('YYYY-MM-DD');
    const rows = await db
      .select()
      .from(dailyReport)
      .where(and(eq(dailyReport.avatarId, avatar.id), eq(dailyReport.day, date)))
      .limit(1);
    if (rows.length === 0) return c.json({ report: null });
    const r = rows[0];
    const report: DailyReport = {
      id: r.id,
      avatarId: r.avatarId,
      day: r.day,
      summary: r.summary,
      stats: r.stats,
      pendingDecisions: r.pendingDecisions,
      cardMsgId: r.cardMsgId,
      createdAt: dayjs(r.createdAt).toISOString(),
    };
    return c.json({ report });
  });

  app.post('/admin/v1/reports/generate', async (c) => {
    const avatar = await requireAvatar(c);
    if (!avatar) return c.json(err('avatar_not_ready', '分身正在初始化'), 409);
    const report = await generateDailyReport(avatar.id, avatar.ownerId, avatar.name);
    return c.json({ report });
  });

  return app;
}

export function startAdminServer() {
  const app = createAdminApp();
  const server = Bun.serve({
    port: config.adminPort,
    hostname: '0.0.0.0',
    fetch: app.fetch,
  });
  log.info('admin api listening', { port: server.port });
  return server;
}
