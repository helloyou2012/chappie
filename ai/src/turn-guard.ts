/**
 * 回合级撤权：运行中冻结、静默、档位到期或任务被接管时，后续动作立即中止。
 *
 * 一个 Agent turn 运行中，主人可能冻结分身、把会话切到静默、或让临时档位到期。
 * 每轮模型调用、每次工具执行、发送回复前都要重新确认「这个回合现在仍然被允许」。
 *
 * 设计取舍：
 *   - 只检查 avatar.status / member.ai_mode / ai_mode_until / task.status，不完整重算 policy；
 *     主人把 auto 切成 manual/draft 时本回合可能继续（已知限制，完整解决需要 core 提供版本号）。
 *   - DB 读取失败 → fail-closed（撤销），宁可少做一次，不做错一次。
 */

import type { AvatarMode } from '@chappie/contract';
import { and, eq } from 'drizzle-orm';
import { dayjs } from './common/datetime';
import { db } from './common/db';
import { agentTask, avatar as avatarTable, member } from './db/schema';

export type TurnPhase = 'run' | 'approval_resume';

export class TurnRevokedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'TurnRevokedError';
  }
}

export interface TurnSnapshot {
  avatarStatus: string | null;
  avatarOwnerId: string | null;
  aiMode: string | null;
  aiModeUntil: string | Date | null;
  memberFound: boolean;
  taskStatus: string | null;
}

export interface TurnEvaluationInput extends TurnSnapshot {
  ownerId: string;
  expectedMode: AvatarMode;
  phase: TurnPhase;
}

/**
 * 会话有效档位：临时档位过期自动回落到 manual。
 * policy.ts 与 turn-guard 共用，避免两处判断漂移。
 */
export function effectiveSessionMode(
  aiMode: string | null | undefined,
  aiModeUntil: string | Date | null | undefined,
  now = dayjs(),
): AvatarMode {
  const mode = (aiMode ?? 'manual') as AvatarMode;
  if (mode === 'manual') return 'manual';
  if (aiModeUntil && dayjs(aiModeUntil).isBefore(now)) return 'manual';
  return mode;
}

export type TurnEvaluation = { allowed: true } | { allowed: false; reason: string };

/** 纯函数：根据快照判断回合是否仍被允许。 */
export function evaluateTurn(input: TurnEvaluationInput, now = dayjs()): TurnEvaluation {
  if (!input.avatarStatus) return { allowed: false, reason: '分身不存在' };
  if (input.avatarStatus !== 'active') return { allowed: false, reason: '分身已被冻结' };
  if (input.avatarOwnerId !== input.ownerId) {
    return { allowed: false, reason: '分身归属不匹配' };
  }

  if (input.phase === 'run') {
    if (!input.taskStatus || !['planning', 'running'].includes(input.taskStatus)) {
      return { allowed: false, reason: '任务已被接管或取消' };
    }
  } else if (!input.taskStatus || !['waiting_approval', 'running'].includes(input.taskStatus)) {
    return { allowed: false, reason: '任务已不在待审批/运行状态' };
  }

  if (!input.memberFound) {
    // 审批续跑的授权来自审批本身；普通运行只有手动档可以在成员关系缺失时继续
    if (input.phase === 'approval_resume') return { allowed: true };
    if (input.expectedMode === 'manual') return { allowed: true };
    return { allowed: false, reason: '会话成员关系缺失' };
  }

  const tempExpired = Boolean(input.aiModeUntil && dayjs(input.aiModeUntil).isBefore(now));
  // 临时的「静默档」到期后应回落到策略兜底，不再视为用户当前选择
  if (input.aiMode === 'off' && !tempExpired) {
    return { allowed: false, reason: '会话已切换为静默档' };
  }
  // auto/draft 的临时档到期才撤销；off 的到期按回落处理
  if (tempExpired && input.aiMode !== 'off' && input.expectedMode !== 'manual') {
    return { allowed: false, reason: '临时档位已到期' };
  }
  return { allowed: true };
}

/** DB 包装：加载快照并抛 TurnRevokedError。 */
export async function assertTurnAllowed(params: {
  taskId: string;
  avatarId: string;
  ownerId: string;
  convId: string;
  expectedMode: AvatarMode;
  phase: TurnPhase;
}): Promise<void> {
  let snapshot: TurnSnapshot;
  try {
    const avatarRows = await db
      .select({ status: avatarTable.status, ownerId: avatarTable.ownerId })
      .from(avatarTable)
      .where(eq(avatarTable.id, params.avatarId))
      .limit(1);
    const memberRows = await db
      .select({ aiMode: member.aiMode, aiModeUntil: member.aiModeUntil })
      .from(member)
      .where(and(eq(member.convId, params.convId), eq(member.principalId, params.ownerId)))
      .limit(1);
    const taskRows = await db
      .select({ status: agentTask.status })
      .from(agentTask)
      .where(eq(agentTask.id, params.taskId))
      .limit(1);
    snapshot = {
      avatarStatus: avatarRows[0]?.status ?? null,
      avatarOwnerId: avatarRows[0]?.ownerId ?? null,
      aiMode: memberRows[0]?.aiMode ?? null,
      aiModeUntil: memberRows[0]?.aiModeUntil ?? null,
      memberFound: memberRows.length > 0,
      taskStatus: taskRows[0]?.status ?? null,
    };
  } catch (e) {
    throw new TurnRevokedError(`无法确认回合权限：${String(e).slice(0, 120)}`);
  }

  const verdict = evaluateTurn({
    ...snapshot,
    ownerId: params.ownerId,
    expectedMode: params.expectedMode,
    phase: params.phase,
  });
  if (!verdict.allowed) throw new TurnRevokedError(verdict.reason);
}
