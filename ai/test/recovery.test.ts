/**
 * 任务断连恢复集成测试 —— 租约 + 检查点 + 幂等账本（设计方案 §27.4 / §26.3）。
 *
 * 前置：PostgreSQL 已启动且执行过 `pnpm ai:migrate`；测试自行创建并清理隔离数据，
 * 不依赖 seed 数据。数据库不可用或迁移未执行时整组跳过。
 *
 * 注意：恢复清扫是全库范围的，dev 库中其它陈旧的孤儿任务也会在测试期间被一并恢复（符合预期行为）。
 *
 * 运行：`pnpm --filter @chappie/ai test`（脚本自动加载 ../.env）。
 *
 * 覆盖：
 *   1. 陈旧任务（>1h）恢复时直接丢弃（§26.3 时效）
 *   2. 检查点续跑：确定未执行 → 幂等工具重执行，仅 1 条回复
 *   3. 账本复用：已完成记录 → 不重复执行
 *   4. 非幂等工具不确定 → 保守转人工（不执行、不发送）
 *   5. 审批续跑中断：确定未执行 → 恰好补跑一次并回填审批结果
 *   6. 审批续跑中断：不确定 → 转人工，转账绝不重复执行
 *   7. 租约围栏：非持有者心跳失败
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

// 测试专用 mock 内部 API。config 是模块级单例且可能已被其它测试文件加载，
// 因此直接改 config 字段（internal 在每次调用时读取），而不是依赖 env 的加载顺序。
const INTERNAL_PORT = 17001;

const { client, db } = await import('../src/common/db');
const { config } = await import('../src/common/config');
const schema = await import('../src/db/schema');
const { sweepOrphanTasks } = await import('../src/recovery');
const { heartbeatOnce } = await import('../src/common/task-lease');

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
// 数据库可用性 + 迁移检查（不可用则跳过整组）
// 注意：不要在测试里 closeDb()——Bun 测试文件共享模块实例，会误关其它文件的连接池。
// ---------------------------------------------------------------------------
let dbReady = false;
try {
  await client`SELECT 1`;
  const cols = await client`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'agent_task' AND column_name IN ('lease_until', 'locked_by')
  `;
  dbReady = cols.length === 2;
} catch {
  dbReady = false;
}
if (!dbReady) {
  console.warn(
    '[recovery.test] 跳过：数据库不可用或未执行 pnpm ai:migrate（需要 agent_task.lease_until/locked_by）',
  );
}
const describeDb = dbReady ? describe : describe.skip;

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ids = {
  user: `u_test_${suffix}`,
  avatar: `a_test_${suffix}`,
  conv: `c_test_${suffix}`,
  policy: `p_test_${suffix}`,
  /** 每个用例一条独立触发消息（UNIQUE(trigger_msg_id, avatar_id)） */
  msgs: Array.from({ length: 8 }, (_, i) => `m_test_${suffix}_${i}`),
};

/** mock 内部 API 的调用记录 */
const deliveries: unknown[] = [];
const cards: { recipientUserId?: string; card?: { kind?: string; reason?: string } }[] = [];
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
      (${ids.user}, 'human', NULL, '测试主人'),
      (${ids.avatar}, 'avatar', ${ids.user}, '测试分身')
  `;
  await db.insert(user).values({ id: ids.user, email: `${ids.user}@test.local`, name: '测试主人' });
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
    name: '测试分身',
    persona: '测试用分身',
    status: 'active',
  });
  await db.insert(policy).values({
    id: ids.policy,
    ownerId: ids.user,
    scopeType: 'global',
    name: '测试策略',
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
  const toolIds = ['calendar.read', 'todo.add', 'todo.list', 'payment.send'];
  await db
    .insert(capabilityGrant)
    .values(toolIds.map((capabilityId) => ({ avatarId: ids.avatar, capabilityId, granted: true })));
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

// ---------------------------------------------------------------------------
// 用例小件
// ---------------------------------------------------------------------------
function checkpointMessages(callId: string, toolName: string, args: Record<string, unknown>) {
  return [
    { role: 'user', content: '帮我查一下今天的日程' },
    { role: 'assistant', content: '', toolCalls: [{ id: callId, name: toolName, args }] },
  ];
}

async function makeOrphanTask(opts: {
  msgIndex: number;
  status: string;
  checkpointCall?: { callId: string; toolName: string; args: Record<string, unknown> };
  context?: Record<string, unknown>;
  createdMinAgo?: number;
}): Promise<string> {
  const taskId = `t_test_${suffix}_${opts.msgIndex}`;
  createdTaskIds.push(taskId);
  const createdMinAgo = opts.createdMinAgo ?? 5;
  await db.insert(agentTask).values({
    id: taskId,
    avatarId: ids.avatar,
    ownerId: ids.user,
    triggerMsgId: ids.msgs[opts.msgIndex],
    triggerConvId: ids.conv,
    triggerKind: 'direct',
    status: opts.status,
    traceId: `trace_${taskId}`,
    context: opts.checkpointCall
      ? {
          checkpoint: {
            messages: checkpointMessages(
              opts.checkpointCall.callId,
              opts.checkpointCall.toolName,
              opts.checkpointCall.args,
            ),
            round: 0,
            stepIdx: 5,
            toolsUsed: [],
            mode: 'auto',
            allowCapabilities: null,
            maxRisk: 'L1',
          },
        }
      : (opts.context ?? null),
    lockedBy: null,
    leaseUntil: new Date(Date.now() - 60_000),
    createdAt: new Date(Date.now() - createdMinAgo * 60_000),
    updatedAt: new Date(Date.now() - createdMinAgo * 60_000),
  });
  return taskId;
}

async function addStep(
  taskId: string,
  type: 'tool' | 'tool_pending',
  toolCallId: string,
  output: unknown,
): Promise<void> {
  await db.insert(taskStep).values({
    taskId,
    idx: type === 'tool' ? 214 : 213,
    type,
    input: { tool: 'test' },
    output,
    toolCallId,
  });
}

/** 触发清扫，直到本用例任务被认领（避免 dev 库里的其它孤儿占用 batch） */
async function sweepUntilClaimed(taskId: string, originalStatus: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await sweepOrphanTasks();
    const rows = await db.select().from(agentTask).where(eq(agentTask.id, taskId));
    const row = rows[0];
    if (!row) return;
    if (row.lockedBy !== null || row.status !== originalStatus) return;
    await sleep(200);
  }
}

async function waitTerminal(taskId: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    const rows = await db.select().from(agentTask).where(eq(agentTask.id, taskId));
    const status = rows[0]?.status ?? 'missing';
    if (['completed', 'failed', 'handed_over', 'skipped', 'cancelled'].includes(status)) {
      return status;
    }
  }
  return 'timeout';
}

async function stepsOf(taskId: string) {
  return db.select().from(taskStep).where(eq(taskStep.taskId, taskId));
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------
describeDb('任务断连恢复（租约 + 检查点 + 幂等账本）', () => {
  beforeAll(async () => {
    server = Bun.serve({ port: INTERNAL_PORT, fetch: mockInternalFetch });
    await cleanup(); // 清理历史残留（同 suffix 不应存在，防御性）
    await createFixtures();
  }, 30_000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    server?.stop(true);
  }, 30_000);

  test('陈旧任务（>1h）恢复时直接丢弃', async () => {
    const taskId = await makeOrphanTask({ msgIndex: 0, status: 'planning', createdMinAgo: 120 });
    await sweepUntilClaimed(taskId, 'planning');
    expect(await waitTerminal(taskId)).toBe('failed');
    const rows = await db.select().from(agentTask).where(eq(agentTask.id, taskId));
    expect(rows[0]?.error).toContain('过期');
  }, 30_000);

  test('检查点续跑：确定未执行的幂等工具重执行，仅 1 条回复', async () => {
    const before = deliveries.length;
    const taskId = await makeOrphanTask({
      msgIndex: 1,
      status: 'running',
      checkpointCall: { callId: 'call_ck_exec', toolName: 'calendar.read', args: { day: 'today' } },
    });
    await sweepUntilClaimed(taskId, 'running');
    expect(await waitTerminal(taskId)).toBe('completed');
    expect(deliveries.length - before).toBe(1);
    const steps = await stepsOf(taskId);
    expect(steps.some((s) => s.type === 'tool' && s.toolCallId === 'call_ck_exec')).toBe(true);
    expect(steps.some((s) => s.type === 'recover')).toBe(true);
    const sent = deliveries.at(-1) as { aiMeta?: { toolsUsed?: string[] } };
    expect(sent.aiMeta?.toolsUsed).toContain('calendar.read');
  }, 30_000);

  test('账本复用：已完成工具结果不重复执行', async () => {
    const before = deliveries.length;
    const taskId = await makeOrphanTask({
      msgIndex: 2,
      status: 'running',
      checkpointCall: {
        callId: 'call_ck_reuse',
        toolName: 'calendar.read',
        args: { day: 'today' },
      },
    });
    await addStep(taskId, 'tool', 'call_ck_reuse', { summary: '账本复用的日程结果' });
    await sweepUntilClaimed(taskId, 'running');
    expect(await waitTerminal(taskId)).toBe('completed');
    expect(deliveries.length - before).toBe(1);
    const rows = (await stepsOf(taskId)).filter((s) => s.toolCallId === 'call_ck_reuse');
    expect(rows.length).toBe(1); // 仅原有完成记录，未新增执行
  }, 30_000);

  test('非幂等工具不确定（有意图标记无完成）→ 保守转人工，不执行不发送', async () => {
    const beforeDeliveries = deliveries.length;
    const beforeCards = cards.length;
    const taskId = await makeOrphanTask({
      msgIndex: 3,
      status: 'running',
      checkpointCall: {
        callId: 'call_ck_uncertain',
        toolName: 'todo.add',
        args: { text: '买咖啡' },
      },
    });
    await addStep(taskId, 'tool_pending', 'call_ck_uncertain', { ok: true });
    await sweepUntilClaimed(taskId, 'running');
    expect(await waitTerminal(taskId)).toBe('handed_over');
    expect(deliveries.length - beforeDeliveries).toBe(0);
    expect(cards.length - beforeCards).toBe(1);
    expect(cards.at(-1)?.card?.kind).toBe('handover');
    const toolSteps = (await stepsOf(taskId)).filter(
      (s) => s.type === 'tool' && s.toolCallId === 'call_ck_uncertain',
    );
    expect(toolSteps.length).toBe(0);
  }, 30_000);

  test('审批续跑中断、确定未执行 → 恰好补跑一次并回填审批结果', async () => {
    const before = deliveries.length;
    const taskId = await makeOrphanTask({
      msgIndex: 4,
      status: 'waiting_approval',
      context: {
        mode: 'auto',
        allowCapabilities: null,
        maxRisk: 'L1',
        convId: ids.conv,
        confidence: 0.9,
      },
    });
    const approvalId = `ap_test_${suffix}_4`;
    await db.insert(approval).values({
      id: approvalId,
      taskId,
      avatarId: ids.avatar,
      approver: ids.user,
      title: '请求执行：发起转账',
      toolName: 'payment.send',
      args: { amount: 300, currency: 'CNY' },
      status: 'approved',
      expiresAt: new Date(Date.now() + 3600_000),
      resolvedAt: new Date(Date.now() - 5 * 60_000), // 超过 120s 宽限
    });
    await sweepUntilClaimed(taskId, 'waiting_approval');
    expect(await waitTerminal(taskId)).toBe('completed');
    expect(deliveries.length - before).toBe(1);
    const aprSteps = (await stepsOf(taskId)).filter((s) => s.toolCallId === `apr_${approvalId}`);
    expect(aprSteps.map((s) => s.type).sort()).toEqual(['tool', 'tool_pending']);
    const aprRows = await db.select().from(approval).where(eq(approval.id, approvalId));
    expect(aprRows[0]?.result).not.toBeNull();
  }, 30_000);

  test('审批续跑中断、不确定 → 转账绝不重复执行', async () => {
    const beforeDeliveries = deliveries.length;
    const beforeCards = cards.length;
    const taskId = await makeOrphanTask({
      msgIndex: 5,
      status: 'waiting_approval',
      context: {
        mode: 'auto',
        allowCapabilities: null,
        maxRisk: 'L1',
        convId: ids.conv,
        confidence: 0.9,
      },
    });
    const approvalId = `ap_test_${suffix}_5`;
    await db.insert(approval).values({
      id: approvalId,
      taskId,
      avatarId: ids.avatar,
      approver: ids.user,
      title: '请求执行：发起转账',
      toolName: 'payment.send',
      args: { amount: 300, currency: 'CNY' },
      status: 'approved',
      expiresAt: new Date(Date.now() + 3600_000),
      resolvedAt: new Date(Date.now() - 5 * 60_000),
    });
    await addStep(taskId, 'tool_pending', `apr_${approvalId}`, { ok: true });
    await sweepUntilClaimed(taskId, 'waiting_approval');
    expect(await waitTerminal(taskId)).toBe('handed_over');
    expect(deliveries.length - beforeDeliveries).toBe(0);
    expect(cards.length - beforeCards).toBe(1);
    const toolSteps = (await stepsOf(taskId)).filter(
      (s) => s.type === 'tool' && s.toolCallId === `apr_${approvalId}`,
    );
    expect(toolSteps.length).toBe(0);
  }, 30_000);

  test('租约围栏：非持有者心跳失败', async () => {
    const taskId = `t_test_${suffix}_fencing`;
    createdTaskIds.push(taskId);
    await db.insert(agentTask).values({
      id: taskId,
      avatarId: ids.avatar,
      ownerId: ids.user,
      triggerMsgId: ids.msgs[6],
      triggerConvId: ids.conv,
      triggerKind: 'direct',
      status: 'planning',
      lockedBy: 'another_worker',
      leaseUntil: new Date(Date.now() + 60_000),
    });
    expect(await heartbeatOnce(taskId)).toBe(false);
  }, 15_000);
});
