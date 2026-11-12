/**
 * 审批参数指纹：审批即数据、参数不可偷换。
 * 纯函数部分始终运行；DB 部分在迁移未执行时自动跳过。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { approvalArgsHash, verifyApprovalArgs } from '../src/approval';

const base = {
  approvalId: 'ap_1',
  taskId: 't_1',
  avatarId: 'a_1',
  approver: 'u_1',
  tool: 'payment.send',
  args: { amount: 200, currency: 'CNY' },
};

describe('approvalArgsHash 域分离', () => {
  test('同一份输入稳定', () => {
    expect(approvalArgsHash(base)).toBe(
      approvalArgsHash({ ...base, args: { currency: 'CNY', amount: 200 } }),
    );
  });

  test('换工具/任务/审批人/参数都会改变指纹', () => {
    const h = approvalArgsHash(base);
    expect(approvalArgsHash({ ...base, tool: 'todo.add' })).not.toBe(h);
    expect(approvalArgsHash({ ...base, taskId: 't_2' })).not.toBe(h);
    expect(approvalArgsHash({ ...base, approver: 'u_2' })).not.toBe(h);
    expect(approvalArgsHash({ ...base, args: { amount: 300 } })).not.toBe(h);
  });

  test('数组顺序保留（不同顺序是不同参数）', () => {
    const a = approvalArgsHash({ ...base, args: { list: [1, 2] } });
    const b = approvalArgsHash({ ...base, args: { list: [2, 1] } });
    expect(a).not.toBe(b);
  });
});

describe('verifyApprovalArgs', () => {
  const record = {
    id: base.approvalId,
    taskId: base.taskId,
    avatarId: base.avatarId,
    approver: base.approver,
    toolName: base.tool,
    argsHash: approvalArgsHash(base),
  };

  test('参数一致通过', () => {
    expect(verifyApprovalArgs(record, base.args)).toEqual({ ok: true, legacy: false });
  });

  test('参数不一致失败并给出 expected/actual', () => {
    const r = verifyApprovalArgs(record, { amount: 999, currency: 'CNY' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.expected).toBe(record.argsHash);
      expect(r.actual).not.toBe(record.argsHash);
    }
  });

  test('legacy NULL 放行并标记', () => {
    expect(verifyApprovalArgs({ ...record, argsHash: null }, { amount: 1 })).toEqual({
      ok: true,
      legacy: true,
    });
  });
});

// ---------------------------------------------------------------------------
// DB 部分：仅验证落库/回读/状态迁移语义，不调用 createApproval(避免依赖内部 API)
// ---------------------------------------------------------------------------
const { client, db } = await import('../src/common/db');
const { approval } = await import('../src/db/schema');
const { getApproval, resolveApproval } = await import('../src/approval');

let dbReady = false;
try {
  const cols = await client`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'approval' AND column_name = 'args_hash'
  `;
  dbReady = cols.length === 1;
} catch {
  dbReady = false;
}
if (!dbReady) {
  console.warn('[approval-hash.test] 跳过 DB 用例：数据库不可用或未执行 pnpm ai:migrate');
}
const describeDb = dbReady ? describe : describe.skip;

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ids: string[] = [];

describeDb('approval 落库与状态迁移', () => {
  afterAll(async () => {
    if (ids.length > 0) await db.delete(approval).where(inArray(approval.id, ids));
  });

  test('getApproval 回读 argsHash；普通 approve 不写 modifiedArgs', async () => {
    const id = `ap_hash_${suffix}_a`;
    ids.push(id);
    await db.insert(approval).values({
      id,
      taskId: `t_${suffix}`,
      avatarId: `a_${suffix}`,
      approver: `u_${suffix}`,
      title: '测试审批',
      toolName: 'payment.send',
      args: { amount: 200 },
      argsHash: approvalArgsHash({
        approvalId: id,
        taskId: `t_${suffix}`,
        avatarId: `a_${suffix}`,
        approver: `u_${suffix}`,
        tool: 'payment.send',
        args: { amount: 200 },
      }),
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const loaded = await getApproval(id);
    expect(loaded?.argsHash).toBeTruthy();
    expect(loaded?.modifiedArgs).toBeNull();

    const first = await resolveApproval(id, 'approved');
    expect(first.transitioned).toBe(true);
    expect(first.record?.status).toBe('approved');
    expect(first.record?.modifiedArgs).toBeNull();

    const second = await resolveApproval(id, 'approved');
    expect(second.transitioned).toBe(false);
  });

  test('modify_approve 写入修改后参数，重复决议不再迁移', async () => {
    const id = `ap_hash_${suffix}_b`;
    ids.push(id);
    await db.insert(approval).values({
      id,
      taskId: `t_${suffix}`,
      avatarId: `a_${suffix}`,
      approver: `u_${suffix}`,
      title: '测试审批',
      toolName: 'payment.send',
      args: { amount: 200 },
      argsHash: null,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const hash = approvalArgsHash({
      approvalId: id,
      taskId: `t_${suffix}`,
      avatarId: `a_${suffix}`,
      approver: `u_${suffix}`,
      tool: 'payment.send',
      args: { amount: 300 },
    });
    const r = await resolveApproval(id, 'modified', { amount: 300 }, hash);
    expect(r.transitioned).toBe(true);
    expect(r.record?.modifiedArgs).toEqual({ amount: 300 });
    expect(r.record?.argsHash).toBe(hash);
    expect((await resolveApproval(id, 'modified', { amount: 400 })).transitioned).toBe(false);
  });
});
