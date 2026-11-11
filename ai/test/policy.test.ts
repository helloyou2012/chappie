/**
 * 策略引擎集成测试 —— 设计方案 §4.2 档位合并 / §4.3 让位降级 / §12 新手档位。
 *
 * 前置：PostgreSQL 已启动且执行过 `pnpm ai:migrate`；不可用时整组跳过。
 * 夹具使用唯一 ID 并在结束后清理。Redis 不可用时相关能力按降级放行处理（与本测试断言无关）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PolicyRule } from '@chappie/contract';
import { and, eq } from 'drizzle-orm';
import type { PolicyInput } from '../src/policy';

const { client, db } = await import('../src/common/db');
const schema = await import('../src/db/schema');
const { classify } = await import('../src/classifier');
const { evaluatePolicy } = await import('../src/policy');

const { avatar, conversation, member, policy, usageDaily } = schema;

const suffix = Date.now().toString(36);
const OWNER = `u_pol_${suffix}`;
const PEER = `u_pol_peer_${suffix}`;
const AVATAR = `a_pol_${suffix}`;
const CONV = `c_pol_${suffix}`;
const POLICY = `p_pol_${suffix}`;

const BASE_RULE: PolicyRule = {
  mode: 'auto',
  schedule: [],
  allowCapabilities: null,
  denyTopics: [],
  maxRisk: 'L2',
  rateLimitPerHour: 1000,
  escalateWhen: [],
};

let dbReady = false;
try {
  await client`SELECT 1 FROM avatar LIMIT 1`;
  await client`SELECT 1 FROM usage_daily LIMIT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}
if (!dbReady) console.warn('[policy.test] 跳过：数据库不可用或未迁移');
const describeDb = dbReady ? describe : describe.skip;

describeDb('evaluatePolicy', () => {
  beforeAll(async () => {
    await client`
      INSERT INTO principal (id, type, owner_id, name) VALUES
        (${OWNER}, 'human', NULL, '策略测试主人'),
        (${PEER}, 'human', NULL, '策略测试联系人')
    `;
    await db.insert(conversation).values({ id: CONV, type: 'direct', systemTag: null });
    await db
      .insert(member)
      .values({ convId: CONV, principalId: OWNER, role: 'owner', aiMode: 'auto' });
    await db.insert(avatar).values({
      id: AVATAR,
      ownerId: OWNER,
      name: '策略测试分身',
      status: 'active',
      dailyBudgetUsd: '1.0',
    });
    await db.insert(policy).values({
      id: POLICY,
      ownerId: OWNER,
      scopeType: 'global',
      name: '测试策略',
      rule: BASE_RULE,
      priority: 0,
    });
  }, 30_000);

  afterAll(async () => {
    await db.delete(usageDaily).where(eq(usageDaily.avatarId, AVATAR));
    await db.delete(policy).where(eq(policy.id, POLICY));
    await db.delete(avatar).where(eq(avatar.id, AVATAR));
    await db.delete(member).where(eq(member.convId, CONV));
    await db.delete(conversation).where(eq(conversation.id, CONV));
    await client`DELETE FROM principal WHERE id IN (${OWNER}, ${PEER})`;
  }, 30_000);

  const setMode = async (mode: string) => {
    await db
      .update(member)
      .set({ aiMode: mode })
      .where(and(eq(member.convId, CONV), eq(member.principalId, OWNER)));
  };
  const setRule = async (patch: Partial<PolicyRule>) => {
    await db
      .update(policy)
      .set({ rule: { ...BASE_RULE, ...patch } })
      .where(eq(policy.id, POLICY));
  };

  const input = (overrides: Partial<PolicyInput> = {}): PolicyInput => ({
    avatarId: AVATAR,
    ownerId: OWNER,
    conv: { id: CONV, type: 'direct', systemTag: null },
    senderType: 'human',
    senderUserId: PEER,
    mentioned: false,
    via: 'direct',
    triggerMessageId: 'm_pol_test',
    classification: classify('明天有空吗？'),
    ...overrides,
  });

  test('分身不存在 → 拒绝', async () => {
    const r = await evaluatePolicy(input({ avatarId: 'a_missing' }));
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('分身不存在');
  });

  test('分身被冻结 → 拒绝', async () => {
    await db.update(avatar).set({ status: 'frozen' }).where(eq(avatar.id, AVATAR));
    const r = await evaluatePolicy(input());
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('冻结');
    await db.update(avatar).set({ status: 'active' }).where(eq(avatar.id, AVATAR));
  });

  test('手动档且未被 @ → 拒绝', async () => {
    await setMode('manual');
    await setRule({ mode: 'manual' });
    const r = await evaluatePolicy(input());
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('手动');
  });

  test('手动档但被 @ → 允许', async () => {
    const r = await evaluatePolicy(input({ mentioned: true }));
    expect(r.allow).toBe(true);
    expect(r.mode).toBe('manual');
  });

  test('静默档 → 拒绝', async () => {
    await setMode('off');
    const r = await evaluatePolicy(input({ mentioned: true }));
    expect(r.allow).toBe(false);
    expect(r.mode).toBe('off');
  });

  test('自动档 → 允许并透传风险上限与能力白名单', async () => {
    await setMode('auto');
    await setRule({ maxRisk: 'L2', allowCapabilities: ['calendar.read'] });
    const r = await evaluatePolicy(input());
    expect(r.allow).toBe(true);
    expect(r.mode).toBe('auto');
    expect(r.maxRisk).toBe('L2');
    expect(r.allowCapabilities).toEqual(['calendar.read']);
  });

  test('命中禁区话题 → 拒绝并要求升级给主人', async () => {
    await setRule({ denyTopics: ['money'] });
    const r = await evaluatePolicy(input({ classification: classify('帮我转账 200 元') }));
    expect(r.allow).toBe(false);
    expect(r.escalate).toBe(true);
    expect(r.reason).toContain('money');
  });

  test('日预算超限：未 @ 时拒绝，@ 时降级为手动仍允许', async () => {
    await setRule({ denyTopics: [] });
    await client`
      INSERT INTO usage_daily (avatar_id, day, provider, model, requests, cost_usd)
      VALUES (${AVATAR}, CURRENT_DATE, 'mock', 'mock-1', 1, 2.0)
      ON CONFLICT DO NOTHING
    `;

    const notMentioned = await evaluatePolicy(input());
    expect(notMentioned.allow).toBe(false);
    expect(notMentioned.reason).toContain('预算');

    const mentioned = await evaluatePolicy(input({ mentioned: true }));
    expect(mentioned.allow).toBe(true);
    expect(mentioned.downgraded).toBe(true);
    expect(mentioned.mode).toBe('manual');

    await db.delete(usageDaily).where(eq(usageDaily.avatarId, AVATAR));
  });

  test('系统会话（主人↔分身）手动档也允许', async () => {
    await setMode('manual');
    await setRule({ mode: 'manual', denyTopics: [] });
    const r = await evaluatePolicy(
      input({
        conv: { id: CONV, type: 'direct', systemTag: 'avatar_self' },
        via: 'self_chat',
        mentioned: true,
      }),
    );
    expect(r.allow).toBe(true);
  });
});
