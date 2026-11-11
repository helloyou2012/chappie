/**
 * 任务租约 —— 设计方案 §27.4「中断恢复」/ §37（PG 为事实来源，Redis 零参与）：
 *   agent_task 上的租约 + 间隔式心跳。租约过期即视为 worker 崩溃，由 recovery 认领续跑。
 *
 * 为什么用 setInterval 心跳而不是自然点续约：translate/summarize 工具内嵌模型调用，
 * 单次工具最坏 3 分钟以上，自然点续约会把崩溃检测延迟拖到 5 分钟；间隔心跳把检测钉在 ~TTL。
 *
 * 围栏（fencing）：所有续约都带 WHERE locked_by = $me，0 行 = 租约已被清扫者夺走
 *   → 僵尸进程置 lost 标志，在下一循环边界抛 LeaseLostError 静默退出（不写任务状态，新主人正在驱动）。
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { agentTask } from '../db/schema';
import { config } from './config';
import { db } from './db';

export const RUNTIME_ID = `worker_${uuidv4().slice(0, 8)}`;
export const LEASE_TTL_S = config.taskLeaseTtlSeconds;

export class LeaseLostError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} lease lost（已被恢复进程认领接管）`);
    this.name = 'LeaseLostError';
  }
}

/** 进程内 lost 标志（围栏判定用） */
const lostTasks = new Set<string>();

function leaseSecondsExpr(): ReturnType<typeof sql> {
  return sql`now() + ${LEASE_TTL_S} * interval '1 second'`;
}

/** 认领/初取租约（无条件写；调用方需配合条件状态迁移保证原子性） */
export async function acquireLease(taskId: string): Promise<void> {
  lostTasks.delete(taskId);
  await db
    .update(agentTask)
    .set({ lockedBy: RUNTIME_ID, leaseUntil: leaseSecondsExpr(), updatedAt: sql`now()` })
    .where(eq(agentTask.id, taskId));
}

/**
 * 单次心跳（同时是同步围栏校验）：
 * 返回 false = 租约被夺/任务已终结，调用方应停止对该任务的一切写入。
 */
export async function heartbeatOnce(taskId: string): Promise<boolean> {
  const rows = await db
    .update(agentTask)
    .set({ leaseUntil: leaseSecondsExpr(), updatedAt: sql`now()` })
    .where(
      and(
        eq(agentTask.id, taskId),
        eq(agentTask.lockedBy, RUNTIME_ID),
        // created：恢复分支 C 重置状态后由 driveTask 立即迁去 planning，留出心跳窗口
        inArray(agentTask.status, ['created', 'planning', 'running']),
      ),
    )
    .returning({ id: agentTask.id });
  if (rows.length === 0) lostTasks.add(taskId);
  return rows.length > 0;
}

/** 在循环/工具边界断言租约仍在（lost 即抛 LeaseLostError） */
export function assertLeaseAlive(taskId: string): void {
  if (lostTasks.has(taskId)) throw new LeaseLostError(taskId);
}

/** 释放租约（任务终结时顺带清理） */
export async function releaseLease(taskId: string): Promise<void> {
  lostTasks.delete(taskId);
  await db
    .update(agentTask)
    .set({ lockedBy: null, leaseUntil: null, updatedAt: sql`now()` })
    .where(and(eq(agentTask.id, taskId), eq(agentTask.lockedBy, RUNTIME_ID)))
    .catch(() => undefined);
}

/**
 * 租约包装器：取租约 → 间隔心跳（0 行即置 lost）→ 执行 fn → finally 清理。
 * fn 内部在关键边界调用 assertLeaseAlive / heartbeatOnce。
 */
export async function withLease<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  await acquireLease(taskId);
  const timer = setInterval(() => {
    void heartbeatOnce(taskId).catch(() => {
      lostTasks.add(taskId);
    });
  }, config.taskHeartbeatMs);
  // 心跳失败不该抛未捕获异常；heartbeatOnce 内部已处理 0 行情形
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
