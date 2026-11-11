/**
 * 工具网关授权与风险分级集成测试 —— 设计方案 §8.2 风险处理 / §27.5 能力声明。
 *
 * 前置：PostgreSQL 已启动且执行过 `pnpm ai:migrate`；不可用时整组跳过。
 * 只依赖 capability_grant 表（无 FK），夹具使用唯一 avatarId 并在结束后清理。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

const { client, db } = await import('../src/common/db');
const { capabilityGrant } = await import('../src/db/schema');
const { BUILTIN_TOOLS, getTool, prepareToolCall } = await import('../src/tool-gateway');

const AVATAR = `a_gw_test_${Date.now().toString(36)}`;

let dbReady = false;
try {
  await client`SELECT 1 FROM capability_grant LIMIT 1`;
  dbReady = true;
} catch (e) {
  dbReady = false;
  console.warn('[tool-gateway.test] DB 检查失败:', String(e));
}
if (!dbReady) console.warn('[tool-gateway.test] 跳过：数据库不可用或未迁移');
const describeDb = dbReady ? describe : describe.skip;

describe('内置工具注册表', () => {
  test('所有工具声明幂等属性，读写工具分类正确', () => {
    for (const tool of BUILTIN_TOOLS) {
      expect(typeof tool.idempotent).toBe('boolean');
    }
    for (const id of ['calendar.read', 'todo.list', 'translate', 'summarize', 'web.search']) {
      expect(getTool(id)?.idempotent).toBe(true);
    }
    for (const id of ['calendar.create', 'todo.add', 'payment.send']) {
      expect(getTool(id)?.idempotent).toBe(false);
    }
  });

  test('未知工具体不存在', () => {
    expect(getTool('no.such.tool')).toBeUndefined();
  });
});

describeDb('prepareToolCall 授权与风险', () => {
  beforeAll(async () => {
    await db
      .insert(capabilityGrant)
      .values(
        ['calendar.read', 'calendar.create', 'todo.add', 'todo.list', 'payment.send'].map(
          (capabilityId) => ({ avatarId: AVATAR, capabilityId, granted: true }),
        ),
      )
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(capabilityGrant).where(eq(capabilityGrant.avatarId, AVATAR));
  });

  const base = { avatarId: AVATAR, policyAllowCapabilities: null, maxRisk: 'L1' as const };

  test('未知工具 → denied', async () => {
    const d = await prepareToolCall({ ...base, toolId: 'no.such.tool', rawArgs: {} });
    expect(d.status).toBe('denied');
  });

  test('未授权能力 → denied', async () => {
    const d = await prepareToolCall({
      avatarId: 'a_not_granted',
      toolId: 'calendar.read',
      rawArgs: {},
      policyAllowCapabilities: null,
      maxRisk: 'L1',
    });
    expect(d.status).toBe('denied');
  });

  test('策略白名单不含该能力 → denied', async () => {
    const d = await prepareToolCall({
      ...base,
      toolId: 'calendar.read',
      rawArgs: {},
      policyAllowCapabilities: ['todo.list'],
    });
    expect(d.status).toBe('denied');
  });

  test('L0 只读 + 合法参数 → ok，并应用 schema 默认值', async () => {
    const d = await prepareToolCall({ ...base, toolId: 'calendar.read', rawArgs: {} });
    expect(d.status).toBe('ok');
    if (d.status === 'ok') expect(d.args).toEqual({ day: 'today' });
  });

  test('参数不合法 → denied', async () => {
    const d = await prepareToolCall({ ...base, toolId: 'todo.add', rawArgs: {} });
    expect(d.status).toBe('denied');
  });

  test('L1 写操作在 maxRisk=L1 内 → ok', async () => {
    const d = await prepareToolCall({
      ...base,
      toolId: 'todo.add',
      rawArgs: { text: '买咖啡' },
    });
    expect(d.status).toBe('ok');
  });

  test('L1 写操作超过策略 maxRisk=L0 → denied', async () => {
    const d = await prepareToolCall({
      ...base,
      toolId: 'todo.add',
      rawArgs: { text: '买咖啡' },
      maxRisk: 'L0',
    });
    expect(d.status).toBe('denied');
  });

  test('L2 高风险 → 无论 maxRisk 一律 need_approval', async () => {
    for (const maxRisk of ['L0', 'L1', 'L2', 'L3'] as const) {
      const d = await prepareToolCall({
        ...base,
        toolId: 'payment.send',
        rawArgs: { amount: 300 },
        maxRisk,
      });
      expect(d.status).toBe('need_approval');
    }
  });
});
