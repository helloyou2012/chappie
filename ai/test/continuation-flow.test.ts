/**
 * 长程任务续驱集成测试 —— 挂起 → scheduler sweep → 从检查点续跑 → 交付 / 护栏收尾。
 *
 * 前置：PostgreSQL + Redis 已启动且执行过 `pnpm ai:migrate`；测试自行创建并清理隔离数据。
 * 数据库不可用或迁移（waiting_continuation 状态）未执行时整组跳过。
 *
 * 覆盖：
 *   1. 正常续驱：检查点续跑，工具结果回填后生成最终回复，任务 completed
 *   2. 整体时限护栏：超时挂起任务转交主人，不再调用模型
 *   3. 取消/让位：状态已变更（cancelled）时 sweep 不认领、不发送
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

const INTERNAL_PORT = 17003;

const { client, db } = await import('../src/common/db');
const { config } = await import('../src/common/config');
const schema = await import('../src/db/schema');
const { sweepContinuations } = await import('../src/continuation');

config.internalBaseUrl = `http://127.0.0.1:${INTERNAL_PORT}`;

const {
  agentTask,
  approval,
  auditLog,
  avatar,
  capabilityGrant,
  conversation,
  member,
  memoryItem,
  message,
  policy,
  taskStep,
  usageDaily,
  user,
} = schema;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 数据库可用性 + 迁移检查
// ---------------------------------------------------------------------------
let dbReady = false;
try {
  await client`SELECT 1`;
  const rows = await client`
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_task_status_check'
      AND pg_get_constraintdef(oid) LIKE '%waiting_continuation%'
  `;
  dbReady = rows.length > 0;
} catch {
  dbReady = false;
}
if (!dbReady) {
  console.warn(
    '[continuation-flow.test] 跳过：数据库不可用或未执行 pnpm ai:migrate（需要 waiting_continuation 状态）',
  );
}
const describeDb = dbReady ? describe : describe.skip;

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ids = {
  user: `u_cont_${suffix}`,
  avatar: `a_cont_${suffix}`,
  conv: `c_cont_${suffix}`,
  policy: `p_cont_${suffix}`,
  msgs: Array.from({ length: 4 }, (_, i) => `m_cont_${suffix}_${i}`),
};

const deliveries: unknown[] = [];
const cards: { card?: { kind?: string; reason?: string } }[] = [];
let server: ReturnType<typeof Bun.serve> | null = null;
const createdTaskIds: string[] = [];

async function mockInternalFetch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (url.pathname === '/internal/v1/get-context') {
    return Response.json({ messages: [], members: [] });
  }
  if (url.pathname === '/internal/v1/send-message') {
    deliveries.push(body);
    return Response.json({ msgId: `m_mock_${Date.now()}`, seq: 1 });
  }
  if (url.pathname === '/internal/v1/push-card') {
    cards.push(body as (typeof cards)[number]);
    return Response.json({ msgId: `m_card_${Date.now()}` });
  }
  if (url.pathname === '/internal/v1/get-presence') return Response.json([]);
  return Response.json({ ok: true });
}

async function createFixtures(): Promise<void> {
  await client`
    INSERT INTO principal (id, type, owner_id, name) VALUES
      (${ids.user}, 'human', NULL, '续驱主人'),
      (${ids.avatar}, 'avatar', ${ids.user}, '续驱分身')
  `;
  await db.insert(user).values({ id: ids.user, email: `${ids.user}@test.local`, name: '续驱主人' });
  await db.insert(conversation).values({ id: ids.conv, type: 'direct', lastSeq: ids.msgs.length });
  await db.insert(member).values([
    { convId: ids.conv, principalId: ids.user, role: 'owner', aiMode: 'auto' },
    { convId: ids.conv, principalId: ids.avatar, role: 'member', aiMode: 'auto' },
  ]);
  for (let i = 0; i < ids.msgs.length; i++) {
    await db.insert(message).values({
      msgId: ids.msgs[i],
      convId: ids.conv,
      seq: i + 1,
      senderId: ids.user,
      senderType: 'human',
      content: { type: 'text', schemaVersion: 1, text: '帮我查一下今天的日程' },
      clientMsgId: `cm_${ids.msgs[i]}`,
    });
  }
  await db.insert(avatar).values({
    id: ids.avatar,
    ownerId: ids.user,
    name: '续驱分身',
    persona: '测试用分身',
    status: 'active',
  });
  await db.insert(policy).values({
    id: ids.policy,
    ownerId: ids.user,
    scopeType: 'global',
    name: '续驱策略',
    rule: {
      mode: 'auto',
      schedule: [],
      allowCapabilities: null,
      denyTopics: [],
      maxRisk: 'L1',
      rateLimitPerHour: 1000,
      escalateWhen: [],
    },
    priority: 0,
  });
  await db.insert(capabilityGrant).values(
    ['calendar.read', 'todo.list'].map((capabilityId) => ({
      avatarId: ids.avatar,
      capabilityId,
      granted: true,
    })),
  );
}

async function cleanup(): Promise<void> {
  if (createdTaskIds.length > 0) {
    await db.delete(taskStep).where(inArray(taskStep.taskId, createdTaskIds));
    await db.delete(approval).where(inArray(approval.taskId, createdTaskIds));
    await db.delete(auditLog).where(inArray(auditLog.taskId, createdTaskIds));
    await db.delete(agentTask).where(inArray(agentTask.id, createdTaskIds));
  }
  if (!dbReady) return;
  await db.delete(memoryItem).where(eq(memoryItem.avatarId, ids.avatar));
  await db.delete(usageDaily).where(eq(usageDaily.avatarId, ids.avatar));
  await db.delete(capabilityGrant).where(eq(capabilityGrant.avatarId, ids.avatar));
  await db.delete(avatar).where(eq(avatar.id, ids.avatar));
  await db.delete(policy).where(eq(policy.id, ids.policy));
  await db.delete(message).where(eq(message.convId, ids.conv));
  await db.delete(member).where(eq(member.convId, ids.conv));
  await db.delete(conversation).where(eq(conversation.id, ids.conv));
  await db.delete(user).where(eq(user.id, ids.user));
  await client`DELETE FROM principal WHERE id IN (${ids.user}, ${ids.avatar})`;
}

/** 挂起任务：检查点里工具结果已回填（与 parkForContinuation 的真实形态一致） */
function parkedCheckpoint() {
  return {
    messages: [
      { role: 'user', content: '帮我查一下今天的日程' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_cont_1', name: 'calendar.read', args: { day: 'today' } }],
      },
      {
        role: 'tool',
        toolCallId: 'call_cont_1',
        content: JSON.stringify({ summary: '今天有 2 项安排：10:00 评审；11:30 1:1' }),
      },
    ],
    round: 1,
    stepIdx: 5,
    toolsUsed: ['calendar.read'],
    mode: 'auto',
    allowCapabilities: null,
    maxRisk: 'L1',
  };
}

async function makeParkedTask(opts: {
  msgIndex: number;
  createdMinAgo?: number;
  status?: string;
  context?: Record<string, unknown>;
}): Promise<string> {
  const taskId = `t_cont_${suffix}_${opts.msgIndex}`;
  createdTaskIds.push(taskId);
  const createdMinAgo = opts.createdMinAgo ?? 1;
  await db.insert(agentTask).values({
    id: taskId,
    avatarId: ids.avatar,
    ownerId: ids.user,
    triggerMsgId: ids.msgs[opts.msgIndex],
    triggerConvId: ids.conv,
    triggerKind: 'self_chat',
    status: opts.status ?? 'waiting_continuation',
    traceId: `trace_${taskId}`,
    context: opts.context ?? { checkpoint: parkedCheckpoint() },
    lockedBy: null,
    leaseUntil: null,
    createdAt: new Date(Date.now() - createdMinAgo * 60_000),
    // 超过续驱延迟（默认 5s），确保本 tick 可见
    updatedAt: new Date(Date.now() - 60_000),
  });
  return taskId;
}

async function waitTerminal(taskId: string): Promise<string> {
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const rows = await db.select().from(agentTask).where(eq(agentTask.id, taskId));
    const status = rows[0]?.status ?? 'missing';
    if (['completed', 'failed', 'handed_over', 'skipped', 'cancelled'].includes(status)) {
      return status;
    }
  }
  return 'timeout';
}

async function sweepUntilClaimed(taskId: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await sweepContinuations();
    const rows = await db.select().from(agentTask).where(eq(agentTask.id, taskId));
    if (rows[0]?.status !== 'waiting_continuation') return;
    await sleep(150);
  }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------
describeDb('长程任务续驱', () => {
  beforeAll(async () => {
    server = Bun.serve({ port: INTERNAL_PORT, fetch: mockInternalFetch });
    await cleanup();
    await createFixtures();
  }, 30_000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    server?.stop(true);
  }, 30_000);

  test('正常续驱：从检查点续跑并交付最终回复', async () => {
    const before = deliveries.length;
    const taskId = await makeParkedTask({ msgIndex: 0 });
    await sweepUntilClaimed(taskId);
    expect(await waitTerminal(taskId)).toBe('completed');
    expect(deliveries.length - before).toBe(1);
    const sent = deliveries.at(-1) as { aiMeta?: { toolsUsed?: string[] } };
    expect(sent.aiMeta?.toolsUsed).toContain('calendar.read');
    // 续驱审计
    const steps = await db.select().from(taskStep).where(eq(taskStep.taskId, taskId));
    expect(steps.some((s) => s.type === 'model')).toBe(true);
  }, 30_000);

  test('整体时限护栏：超时任务转交主人，不产生外发消息', async () => {
    const beforeDeliveries = deliveries.length;
    const beforeCards = cards.length;
    // 2 小时前创建 > AI_LONG_TASK_MAX_S（默认 1800s）
    const taskId = await makeParkedTask({ msgIndex: 1, createdMinAgo: 120 });
    await sweepUntilClaimed(taskId);
    expect(await waitTerminal(taskId)).toBe('handed_over');
    expect(deliveries.length - beforeDeliveries).toBe(0);
    expect(cards.length - beforeCards).toBe(1);
    expect(cards.at(-1)?.card?.kind).toBe('handover');
    const rows = await db.select().from(agentTask).where(eq(agentTask.id, taskId));
    expect(rows[0]?.result).toContain('整体时限');
  }, 30_000);

  test('外部会话已发「处理中」：护栏停止时补一句收尾', async () => {
    const beforeDeliveries = deliveries.length;
    const taskId = await makeParkedTask({
      msgIndex: 3,
      createdMinAgo: 120,
      context: {
        checkpoint: parkedCheckpoint(),
        continuation: { segmentCount: 2, interimSent: true },
      },
    });
    await sweepUntilClaimed(taskId);
    expect(await waitTerminal(taskId)).toBe('handed_over');
    expect(deliveries.length - beforeDeliveries).toBe(1);
    const sent = deliveries.at(-1) as { content?: { text?: string } };
    expect(sent.content?.text).toContain('交给主人本人跟进');
  }, 30_000);

  test('已取消任务不会被续驱', async () => {
    const before = deliveries.length;
    const taskId = await makeParkedTask({ msgIndex: 2, status: 'cancelled' });
    await sweepContinuations();
    await sleep(500);
    const rows = await db.select().from(agentTask).where(eq(agentTask.id, taskId));
    expect(rows[0]?.status).toBe('cancelled');
    expect(deliveries.length - before).toBe(0);
  }, 15_000);
});
