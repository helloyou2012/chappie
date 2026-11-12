/**
 * 审批操作者与过期校验 —— 署名不等于权威。
 * 只测试会提前返回的路径（不触发 internal.pushCard / 工具执行）。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';

const { client, db } = await import('../src/common/db');
const { approval } = await import('../src/db/schema');
const { getApproval } = await import('../src/approval');
const { resumeFromApproval } = await import('../src/agent-runtime');

let dbReady = false;
try {
  await client`SELECT 1 FROM approval LIMIT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}
if (!dbReady) console.warn('[approval-auth.test] 跳过：数据库不可用或未迁移');
const describeDb = dbReady ? describe : describe.skip;

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ids: string[] = [];

function approvalRow(id: string, expiresAt: Date): typeof approval.$inferInsert {
  return {
    id,
    taskId: `t_auth_${suffix}`,
    avatarId: `a_auth_${suffix}`,
    approver: `u_owner_${suffix}`,
    title: '测试审批',
    toolName: 'payment.send',
    args: { amount: 200, currency: 'CNY' },
    status: 'pending',
    expiresAt,
  };
}

describeDb('审批只认主人', () => {
  afterAll(async () => {
    if (ids.length > 0) await db.delete(approval).where(inArray(approval.id, ids));
  });

  test('非主人操作者不能批准，审批保持 pending', async () => {
    const id = `ap_auth_${suffix}_actor`;
    ids.push(id);
    await db.insert(approval).values(approvalRow(id, new Date(Date.now() + 60_000)));

    const out = await resumeFromApproval(id, 'approve', undefined, `u_intruder_${suffix}`);
    expect(out).toBeNull();
    expect((await getApproval(id))?.status).toBe('pending');
  });

  test('过期审批即使主人批准也不执行，保持 pending 交给 sweep', async () => {
    const id = `ap_auth_${suffix}_expired`;
    ids.push(id);
    await db.insert(approval).values(approvalRow(id, new Date(Date.now() - 60_000)));

    const out = await resumeFromApproval(id, 'approve', undefined, `u_owner_${suffix}`);
    expect(out).toBeNull();
    expect((await getApproval(id))?.status).toBe('pending');
  });
});
