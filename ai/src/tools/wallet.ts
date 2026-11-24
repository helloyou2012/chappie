/**
 * 应用内演示账本（非真实资金）：
 *   wallet.balance 查询余额；payment.send L2 审批后原子转账，按 task_id 幂等。
 * 后续接真实支付网关时，只需替换 exec 内的结算实现。
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../common/config';
import { db } from '../common/db';
import { newId } from '../common/log';
import { wallet, walletTxn } from '../db/schema';
import type { BuiltinTool } from '../tool-gateway';
import { contactLabel, resolveContactMatches } from './contacts';

async function ensureWallet(userId: string): Promise<void> {
  await db
    .insert(wallet)
    .values({ userId, balance: config.walletInitialBalance.toFixed(2) })
    .onConflictDoNothing();
}

async function balanceOf(userId: string): Promise<number> {
  const rows = await db
    .select({ balance: wallet.balance })
    .from(wallet)
    .where(eq(wallet.userId, userId))
    .limit(1);
  return Number(rows[0]?.balance ?? 0);
}

export const walletTools: BuiltinTool[] = [
  {
    id: 'wallet.balance',
    name: '查询余额',
    description: '查询你的应用内演示账本余额（非真实资金）',
    risk: 'L0',
    idempotent: true,
    jsonSchema: { type: 'object', properties: {} },
    validate: z.object({}),
    async exec(_args, ctx) {
      await ensureWallet(ctx.ownerId);
      const balance = await balanceOf(ctx.ownerId);
      return {
        summary: `你的应用内余额：¥${balance.toFixed(2)}（演示账本，非真实资金）`,
        balance,
        currency: 'CNY',
      };
    },
  },
  {
    id: 'payment.send',
    name: '应用内转账',
    description: '给联系人转账（应用内演示账本，非真实资金；高风险，需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['to', 'amount'],
      properties: {
        to: { type: 'string', description: '联系人姓名、备注名或邮箱' },
        amount: { type: 'number', description: '金额（元）' },
        note: { type: 'string', description: '转账备注，可选' },
      },
    },
    validate: z.object({
      to: z.string().min(1).max(100),
      amount: z.number().positive().max(10_000_000),
      note: z.string().max(200).optional(),
    }),
    async exec(args, ctx) {
      const matches = await resolveContactMatches(ctx.ownerId, String(args.to));
      if (matches.length === 0) {
        return { ok: false, summary: `没找到联系人「${String(args.to)}」，无法转账。` };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          summary: `找到多个匹配「${String(args.to)}」的联系人（${matches
            .map(contactLabel)
            .join('、')}），请说得更具体一些。`,
        };
      }
      const target = matches[0]!;
      if (target.userId === ctx.ownerId) {
        return { ok: false, summary: '不能给自己转账。' };
      }
      const amount = Math.round(Number(args.amount) * 100) / 100;
      if (amount <= 0) return { ok: false, summary: '转账金额必须大于 0。' };
      const note = typeof args.note === 'string' ? args.note.trim().slice(0, 200) : null;

      await ensureWallet(ctx.ownerId);
      await ensureWallet(target.userId);

      const result = await db.transaction(async (tx) => {
        // 幂等：同一任务只允许一笔转账
        const existing = await tx
          .select()
          .from(walletTxn)
          .where(eq(walletTxn.taskId, ctx.taskId))
          .limit(1);
        if (existing[0]) return { txn: existing[0], balance: null as number | null };

        // 按 userId 排序加锁，避免双向转账死锁
        const ids = [ctx.ownerId, target.userId].sort();
        const rows = await tx
          .select()
          .from(wallet)
          .where(inArray(wallet.userId, ids))
          .for('update');
        const fromRow = rows.find((r) => r.userId === ctx.ownerId);
        if (!fromRow) throw new Error('发送方账本不存在');
        const fromBalance = Number(fromRow.balance);
        if (fromBalance < amount) {
          throw new Error(`余额不足：当前 ¥${fromBalance.toFixed(2)}，需要 ¥${amount.toFixed(2)}`);
        }

        await tx
          .update(wallet)
          .set({
            balance: sql`${wallet.balance} - ${amount.toFixed(2)}::numeric`,
            updatedAt: sql`now()`,
          })
          .where(eq(wallet.userId, ctx.ownerId));
        await tx
          .update(wallet)
          .set({
            balance: sql`${wallet.balance} + ${amount.toFixed(2)}::numeric`,
            updatedAt: sql`now()`,
          })
          .where(eq(wallet.userId, target.userId));

        const txnId = newId('tx');
        const inserted = await tx
          .insert(walletTxn)
          .values({
            id: txnId,
            fromUserId: ctx.ownerId,
            toUserId: target.userId,
            amount: amount.toFixed(2),
            currency: 'CNY',
            note,
            taskId: ctx.taskId,
          })
          .onConflictDoNothing()
          .returning();
        // 并发重复：回滚余额变更，复用已有流水
        if (!inserted[0]) throw new Error('转账已存在（幂等冲突）');
        return { txn: inserted[0], balance: fromBalance - amount };
      });

      const txn = result.txn;
      const balance = result.balance ?? (await balanceOf(ctx.ownerId));
      return {
        ok: true,
        transactionId: txn.id,
        amount,
        currency: 'CNY',
        balance,
        summary: `已从应用内账本向 ${contactLabel(target)} 转账 ¥${amount.toFixed(
          2,
        )}（交易 ${txn.id}，余额 ¥${balance.toFixed(2)}）。这是演示账本，非真实资金。`,
      };
    },
  },
];
