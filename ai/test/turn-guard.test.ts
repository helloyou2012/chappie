/** 回合级撤权：纯函数判定 + DB 快照加载。 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import {
  assertTurnAllowed,
  effectiveSessionMode,
  evaluateTurn,
  type TurnEvaluationInput,
  TurnRevokedError,
} from '../src/turn-guard';

const base: TurnEvaluationInput = {
  avatarStatus: 'active',
  avatarOwnerId: 'u1',
  aiMode: 'auto',
  aiModeUntil: null,
  memberFound: true,
  taskStatus: 'planning',
  ownerId: 'u1',
  expectedMode: 'auto',
  phase: 'run',
};

function input(over: Partial<TurnEvaluationInput>): TurnEvaluationInput {
  return { ...base, ...over };
}

describe('evaluateTurn', () => {
  test('正常回合允许', () => {
    expect(evaluateTurn(input({}))).toEqual({ allowed: true });
  });

  test('分身不存在/冻结 → 撤销', () => {
    expect(evaluateTurn(input({ avatarStatus: null })).allowed).toBe(false);
    expect(evaluateTurn(input({ avatarStatus: 'frozen' })).allowed).toBe(false);
  });

  test('分身归属不匹配 → 撤销', () => {
    expect(evaluateTurn(input({ avatarOwnerId: 'u2' })).allowed).toBe(false);
  });

  test('运行中任务被接管/取消 → 撤销', () => {
    for (const status of ['handed_over', 'cancelled', 'completed', 'failed']) {
      expect(evaluateTurn(input({ taskStatus: status })).allowed).toBe(false);
    }
    expect(evaluateTurn(input({ taskStatus: 'running' })).allowed).toBe(true);
  });

  test('审批续跑允许 waiting_approval', () => {
    expect(
      evaluateTurn(input({ phase: 'approval_resume', taskStatus: 'waiting_approval' })).allowed,
    ).toBe(true);
    expect(
      evaluateTurn(input({ phase: 'approval_resume', taskStatus: 'handed_over' })).allowed,
    ).toBe(false);
  });

  test('成员关系缺失：手动档与审批续跑放行，auto 撤销', () => {
    expect(evaluateTurn(input({ memberFound: false, expectedMode: 'manual' })).allowed).toBe(true);
    expect(
      evaluateTurn(
        input({
          memberFound: false,
          phase: 'approval_resume',
          taskStatus: 'waiting_approval',
        }),
      ).allowed,
    ).toBe(true);
    expect(evaluateTurn(input({ memberFound: false, expectedMode: 'auto' })).allowed).toBe(false);
  });

  test('静默档 → 撤销', () => {
    expect(evaluateTurn(input({ aiMode: 'off' })).allowed).toBe(false);
    expect(
      evaluateTurn(input({ aiMode: 'off', aiModeUntil: new Date(Date.now() + 60_000) })).allowed,
    ).toBe(false);
  });

  test('临时的静默档到期后按回落处理，不误撤销', () => {
    expect(
      evaluateTurn(
        input({
          aiMode: 'off',
          aiModeUntil: new Date(Date.now() - 60_000),
          expectedMode: 'auto',
        }),
      ).allowed,
    ).toBe(true);
  });

  test('临时档到期：非手动档撤销，手动档放行', () => {
    const past = new Date(Date.now() - 60_000);
    expect(evaluateTurn(input({ aiModeUntil: past, expectedMode: 'auto' })).allowed).toBe(false);
    expect(evaluateTurn(input({ aiModeUntil: past, expectedMode: 'manual' })).allowed).toBe(true);
  });

  test('临时档未到期 → 允许', () => {
    const future = new Date(Date.now() + 60_000);
    expect(evaluateTurn(input({ aiModeUntil: future, expectedMode: 'auto' })).allowed).toBe(true);
  });
});

describe('effectiveSessionMode', () => {
  test('临时档到期回落到 manual', () => {
    expect(effectiveSessionMode('auto', new Date(Date.now() - 1000))).toBe('manual');
    expect(effectiveSessionMode('auto', new Date(Date.now() + 60_000))).toBe('auto');
    expect(effectiveSessionMode('manual', null)).toBe('manual');
    expect(effectiveSessionMode(null, null)).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// DB 包装：验证快照加载与异常语义
// ---------------------------------------------------------------------------
const { client, db } = await import('../src/common/db');
const schema = await import('../src/db/schema');
const { agentTask, avatar, conversation, member } = schema;

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER = `u_tg_${suffix}`;
const CONV = `c_tg_${suffix}`;
const AVATAR = `a_tg_${suffix}`;
const TASK = `t_tg_${suffix}`;

let dbReady = false;
try {
  await client`SELECT 1 FROM agent_task LIMIT 1`;
  await client`SELECT 1 FROM principal LIMIT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}
if (!dbReady) console.warn('[turn-guard.test] 跳过 DB 用例：数据库不可用或未迁移');
const describeDb = dbReady ? describe : describe.skip;

describeDb('assertTurnAllowed', () => {
  beforeAll(async () => {
    await client`INSERT INTO principal (id, type, owner_id, name) VALUES (${OWNER}, 'human', NULL, '撤权测试主人')`;
    await db.insert(conversation).values({ id: CONV, type: 'group', systemTag: null });
    await db
      .insert(member)
      .values({ convId: CONV, principalId: OWNER, role: 'owner', aiMode: 'auto' });
    await db.insert(avatar).values({
      id: AVATAR,
      ownerId: OWNER,
      name: '撤权测试分身',
      status: 'active',
      dailyBudgetUsd: '1.0',
    });
    await db.insert(agentTask).values({
      id: TASK,
      avatarId: AVATAR,
      ownerId: OWNER,
      triggerKind: 'mention',
      status: 'planning',
    });
  }, 30_000);

  afterAll(async () => {
    await db.delete(agentTask).where(eq(agentTask.id, TASK));
    await db.delete(avatar).where(eq(avatar.id, AVATAR));
    await db.delete(member).where(eq(member.convId, CONV));
    await db.delete(conversation).where(eq(conversation.id, CONV));
    await client`DELETE FROM principal WHERE id = ${OWNER}`;
  }, 30_000);

  const check = () =>
    assertTurnAllowed({
      taskId: TASK,
      avatarId: AVATAR,
      ownerId: OWNER,
      convId: CONV,
      expectedMode: 'auto',
      phase: 'run',
    });

  test('正常快照通过', async () => {
    await expect(check()).resolves.toBeUndefined();
  });

  test('冻结后撤销', async () => {
    await db.update(avatar).set({ status: 'frozen' }).where(eq(avatar.id, AVATAR));
    await expect(check()).rejects.toBeInstanceOf(TurnRevokedError);
    await db.update(avatar).set({ status: 'active' }).where(eq(avatar.id, AVATAR));
  });

  test('会话切静默后撤销', async () => {
    await db
      .update(member)
      .set({ aiMode: 'off' })
      .where(and(eq(member.convId, CONV), eq(member.principalId, OWNER)));
    await expect(check()).rejects.toBeInstanceOf(TurnRevokedError);
    await db
      .update(member)
      .set({ aiMode: 'auto' })
      .where(and(eq(member.convId, CONV), eq(member.principalId, OWNER)));
  });

  test('任务被接管后撤销', async () => {
    await db.update(agentTask).set({ status: 'handed_over' }).where(eq(agentTask.id, TASK));
    await expect(check()).rejects.toBeInstanceOf(TurnRevokedError);
    await db.update(agentTask).set({ status: 'planning' }).where(eq(agentTask.id, TASK));
  });

  test('审批续跑允许 waiting_approval', async () => {
    await db.update(agentTask).set({ status: 'waiting_approval' }).where(eq(agentTask.id, TASK));
    await expect(
      assertTurnAllowed({
        taskId: TASK,
        avatarId: AVATAR,
        ownerId: OWNER,
        convId: CONV,
        expectedMode: 'auto',
        phase: 'approval_resume',
      }),
    ).resolves.toBeUndefined();
    await db.update(agentTask).set({ status: 'planning' }).where(eq(agentTask.id, TASK));
  });
});
