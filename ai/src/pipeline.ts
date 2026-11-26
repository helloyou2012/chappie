/**
 * 事件处理流水线 —— 设计方案 §27.3：
 * message.created → router（候选分身）→ policy（档位/让位/限流）→
 * classifier（意图）→ agent-task 建立 → agent-runtime 执行。
 *
 * driveTask 持任务租约执行（task-lease）；崩溃后由 recovery.ts 认领续跑 —— 设计方案 §27.4。
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { contentText, type MemberSnapshot, type Message } from '@chappie/contract';
import { and, asc, desc, eq, gt, gte, inArray, ne, sql } from 'drizzle-orm';
import { runAgent } from './agent-runtime';
import { type Classification, classify } from './classifier';
import { rankReplies } from './classifier-model';
import { config } from './common/config';
import { db } from './common/db';
import { internal } from './common/internal';
import { log, newId, newTraceId } from './common/log';
import { aiKeys, redisSemaphoreAcquire, redisSemaphoreRelease, redisSetNx } from './common/redis';
import { LEASE_TTL_S, LeaseLostError, RUNTIME_ID, withLease } from './common/task-lease';
import { agentTask, avatar, conversation, message as messageTable, user } from './db/schema';
import {
  CONTINUATION_WINDOW_MS,
  deriveEngagement,
  type EngagementContext,
  type EngagementMessage,
  type ReplyTarget,
} from './engagement';
import { hasReplyCue, loadLinearModel, rankRoleCandidates } from './linear-pairwise';
import { resolveMentionIds } from './mentions';
import { evaluatePolicy } from './policy';
import { buildReplyContext } from './reply-context';
import { hasRoleMetadata, matchRoleCandidates } from './role-match';
import { findCandidates } from './router';
import { shouldStaySilent } from './silence';
import { redactSecrets } from './trust';

/** 恢复重驱时分身并发已满：由 recovery 下个 tick 重试（区别于普通路径的 skip） */
export class SemaphoreFullError extends Error {
  constructor(taskId: string) {
    super(`avatar concurrency full while recovering task ${taskId}`);
    this.name = 'SemaphoreFullError';
  }
}

export async function processMessageCreated(data: {
  message: Message;
  members: MemberSnapshot[];
}): Promise<void> {
  const { message, members } = data;

  if (message.senderType === 'system') return;
  // 卡片消息（分身发出的通知）不触发新链路
  if (message.content.type === 'card') return;

  // 附件突发合并：同一发送者先发图片/文件、随后发文本时，只让最后一条触发一次回复。
  // outbox 按会话串行，这里的等待会让后续消息排在本条之后，但消息已落库，可直接查询到。
  if (
    config.attachmentBurstMs > 0 &&
    message.senderType === 'human' &&
    (message.content.type === 'image' || message.content.type === 'file') &&
    !message.mentions?.length
  ) {
    await sleep(config.attachmentBurstMs);
    const later = await db
      .select({ msgId: messageTable.msgId })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.convId, message.convId),
          eq(messageTable.senderId, message.senderId),
          eq(messageTable.senderType, 'human'),
          gt(messageTable.seq, message.seq),
        ),
      )
      .orderBy(asc(messageTable.seq))
      .limit(1);
    if (later.length > 0) {
      log.info('attachment burst: superseded by later message', {
        msgId: message.msgId,
        laterMsgId: later[0]!.msgId,
      });
      return;
    }
  }

  const convRows = await db
    .select({ id: conversation.id, type: conversation.type, systemTag: conversation.systemTag })
    .from(conversation)
    .where(eq(conversation.id, message.convId))
    .limit(1);
  const conv = convRows[0];
  if (!conv) return;

  // 手动输入的 @昵称补成 mentions（同名真人与分身时优先分身，尊重显式选择）
  const routedMessage = await resolveTextMentions(message, members).catch((e) => {
    log.warn('resolve text mentions failed', { msgId: message.msgId, error: String(e) });
    return message;
  });

  const text = routedMessage.content.type === 'text' ? routedMessage.content.text : '';
  const classification = classify(text);
  const engagement = await loadEngagement(routedMessage, members, conv);
  const candidates = findCandidates(
    routedMessage,
    members,
    {
      id: conv.id,
      type: conv.type,
      systemTag: conv.systemTag,
    },
    engagement,
  );
  if (candidates.length === 0) return;

  let routedCandidates = candidates;
  const modelApproved = new Set<string>();

  // 工作群角色匹配：不依赖 GPU/模型，按职责关键词/点名筛选候选。
  // 有角色元数据时它优先于 pairwise 模型。
  let roleFiltered: string[] | null = null;

  // 本地线性 pairwise 角色模型（LLM 生成数据训练）：在无显式 @ 的工作群里，
  // 对所有 auto/direct 候选打分，超过阈值才允许最匹配的一个回复。
  if (
    config.roleModel === 'linear' &&
    conv.type === 'group' &&
    routedMessage.mentions.length === 0
  ) {
    const eligible = candidates.filter((c) => c.via === 'auto' || c.via === 'direct');
    if (eligible.length > 0 && !hasReplyCue(contentText(routedMessage.content))) {
      // 纯通知/公告/闲聊：没有回应线索，不让 auto/direct 分身接话。
      const eligibleSet = new Set(eligible.map((c) => c.avatarId));
      roleFiltered = [];
      routedCandidates = candidates.filter((c) => !eligibleSet.has(c.avatarId));
      log.info('linear role match: no reply cue', {
        msgId: message.msgId,
        candidates: eligible.length,
      });
    } else if (eligible.length > 0) {
      const ctx = await internal
        .getContext(routedMessage.convId, 20, eligible[0]!.ownerId)
        .catch(() => null);
      if (ctx) {
        const linearMembers = ctx.members.map((m) => ({
          principalId: m.principalId,
          name: m.name,
          principalType: m.principalType,
          jobRole: m.jobRole ?? '',
          department: m.department ?? '',
        }));
        if (hasRoleMetadata(linearMembers)) {
          const ranked = rankRoleCandidates(
            {
              text: contentText(routedMessage.content),
              senderId: routedMessage.senderId,
              contextLength: ctx.messages.filter((m) => m.seq < routedMessage.seq).length,
              members: linearMembers,
              candidates: eligible.map((c) => ({ avatarId: c.avatarId, ownerId: c.ownerId })),
            },
            loadLinearModel(config.roleModelPath || undefined),
          );
          if (ranked) {
            const eligibleSet = new Set(eligible.map((c) => c.avatarId));
            roleFiltered = ranked.chosenAvatarId ? [ranked.chosenAvatarId] : [];
            if (ranked.chosenAvatarId) modelApproved.add(ranked.chosenAvatarId);
            routedCandidates = [
              ...candidates.filter((c) => !eligibleSet.has(c.avatarId)),
              ...eligible.filter((c) => roleFiltered!.includes(c.avatarId)),
            ];
            log.info('linear role match', {
              msgId: message.msgId,
              chosenAvatarId: ranked.chosenAvatarId,
              topScore: Number((ranked.scores[ranked.top] ?? 0).toFixed(3)),
              threshold: ranked.threshold,
              candidates: eligible.length,
            });
          }
        }
      }
    }
  }

  // mmBERT 模式：纯通知/公告先由回应线索门控，避免把无请求的消息送进 /rank。
  if (
    config.roleModel === 'mmbert' &&
    conv.type === 'group' &&
    routedMessage.mentions.length === 0
  ) {
    const eligible = candidates.filter((c) => c.via === 'auto' || c.via === 'direct');
    if (eligible.length > 0 && !hasReplyCue(contentText(routedMessage.content))) {
      const eligibleSet = new Set(eligible.map((c) => c.avatarId));
      roleFiltered = [];
      routedCandidates = candidates.filter((c) => !eligibleSet.has(c.avatarId));
      log.info('mmbert role match: no reply cue', {
        msgId: message.msgId,
        candidates: eligible.length,
      });
    }
  }

  if (roleFiltered === null && config.roleMatch && config.roleModel !== 'mmbert') {
    const eligibleForRole = candidates.filter((c) => c.via === 'auto' || c.via === 'direct');
    if (eligibleForRole.length > 0) {
      const roleCtx = await internal
        .getContext(routedMessage.convId, 20, eligibleForRole[0]!.ownerId)
        .catch(() => null);
      if (roleCtx) {
        roleFiltered = matchRoleCandidates({
          text: contentText(routedMessage.content),
          senderId: routedMessage.senderId,
          members: roleCtx.members.map((m) => ({
            principalId: m.principalId,
            name: m.name,
            principalType: m.principalType,
            ownerId: m.ownerId,
            jobRole: m.jobRole ?? '',
            department: m.department ?? '',
          })),
          candidates: candidates.map((c) => ({
            avatarId: c.avatarId,
            ownerId: c.ownerId,
            via: c.via,
          })),
          needReply: classification.needReply,
        });
        if (roleFiltered !== null) {
          const eligibleSet = new Set(eligibleForRole.map((c) => c.avatarId));
          routedCandidates = [
            ...candidates.filter((c) => !eligibleSet.has(c.avatarId)),
            ...eligibleForRole.filter((c) => roleFiltered!.includes(c.avatarId)),
          ];
          log.info('role match', {
            msgId: message.msgId,
            allowed: roleFiltered.length,
            candidates: eligibleForRole.length,
          });
        }
      }
    }
  }

  // Pairwise 角色匹配：同一消息下把所有 auto/direct 观察者作为候选，
  // 模型打分后只保留最匹配的一个；显式 @/回复/延续不参与。
  if (
    roleFiltered === null &&
    config.classifierBaseUrl &&
    config.classifierTimeoutMs > 0 &&
    routedMessage.mentions.length === 0
  ) {
    const eligible = candidates.filter((c) => c.via === 'auto' || c.via === 'direct');
    if (eligible.length > 0) {
      const ctx = await internal
        .getContext(routedMessage.convId, 20, eligible[0]!.ownerId)
        .catch(() => null);
      if (ctx) {
        const texts = eligible.map((candidate) => {
          const observer = ctx.members.find((m) => m.principalId === candidate.avatarId);
          const owner = ctx.members.find((m) => m.principalId === candidate.ownerId);
          return buildReplyContext({
            convType: conv.type === 'group' ? 'group' : 'direct',
            observer: {
              id: candidate.avatarId,
              name: observer?.name ?? candidate.avatarId,
              ownerName: owner?.name ?? candidate.ownerId,
              ownerRole: owner?.jobRole ?? '',
              ownerDepartment: owner?.department ?? '',
              mode: 'auto',
            },
            members: ctx.members.map((m) => ({
              principalId: m.principalId,
              name: m.name,
              principalType: m.principalType,
              ownerId: m.ownerId,
              jobRole: m.jobRole ?? '',
              department: m.department ?? '',
            })),
            messages: ctx.messages,
            trigger: routedMessage,
          });
        });
        const silenceText = buildReplyContext({
          convType: conv.type === 'group' ? 'group' : 'direct',
          observer: {
            id: '__silence__',
            name: '保持沉默',
            ownerName: '无',
            ownerRole: '',
            ownerDepartment: '',
            mode: 'auto',
          },
          members: ctx.members.map((m) => ({
            principalId: m.principalId,
            name: m.name,
            principalType: m.principalType,
            ownerId: m.ownerId,
            jobRole: m.jobRole ?? '',
            department: m.department ?? '',
          })),
          messages: ctx.messages,
          trigger: routedMessage,
        });
        const ranking = await rankReplies([...texts, silenceText]);
        if (!ranking && config.roleMatch) {
          // mmBERT 服务超时/不可用：回退到角色关键词规则
          const fallback = matchRoleCandidates({
            text: contentText(routedMessage.content),
            senderId: routedMessage.senderId,
            members: ctx.members.map((m) => ({
              principalId: m.principalId,
              name: m.name,
              principalType: m.principalType,
              ownerId: m.ownerId,
              jobRole: m.jobRole ?? '',
              department: m.department ?? '',
            })),
            candidates: eligible.map((c) => ({
              avatarId: c.avatarId,
              ownerId: c.ownerId,
              via: c.via,
            })),
            needReply: classification.needReply,
          });
          if (fallback !== null) {
            const eligibleSet = new Set(eligible.map((c) => c.avatarId));
            roleFiltered = fallback;
            routedCandidates = [
              ...candidates.filter((c) => !eligibleSet.has(c.avatarId)),
              ...eligible.filter((c) => fallback.includes(c.avatarId)),
            ];
            log.warn('mmbert unavailable: fallback role rule', {
              msgId: message.msgId,
              allowed: fallback.length,
              candidates: eligible.length,
            });
          }
        }
        if (ranking) {
          let topIdx = 0;
          for (let i = 1; i < texts.length; i++) {
            if (ranking.scores[i]! > ranking.scores[topIdx]!) topIdx = i;
          }
          const silenceScore = ranking.scores[texts.length] ?? Number.NEGATIVE_INFINITY;
          const marginOk =
            ranking.scores[topIdx] !== undefined &&
            ranking.scores[topIdx]! - silenceScore >= config.classifierRankMinMargin;
          if (!marginOk) {
            routedCandidates = candidates.filter((c) => !eligible.includes(c));
            log.info('pairwise role match: silence', {
              msgId: message.msgId,
              score: Number((ranking.scores[topIdx] ?? 0).toFixed(3)),
              silenceScore: Number(silenceScore.toFixed(3)),
              candidates: eligible.length,
            });
          } else {
            const chosen = eligible[topIdx];
            if (chosen) {
              modelApproved.add(chosen.avatarId);
              routedCandidates = [...candidates.filter((c) => !eligible.includes(c)), chosen];
              log.info('pairwise role match', {
                msgId: message.msgId,
                chosenAvatarId: chosen.avatarId,
                prob: Number((ranking.probs[topIdx] ?? 0).toFixed(3)),
                candidates: eligible.length,
              });
            }
          }
        }
      }
    }
  }

  for (const candidate of routedCandidates) {
    // 快速去重（PG 唯一键兜底 —— 设计方案 §26.3）
    if (!(await redisSetNx(aiKeys.dedup(message.msgId, candidate.avatarId), 600))) continue;
    void processCandidate({
      message: routedMessage,
      classification,
      candidate,
      modelApproved: modelApproved.has(candidate.avatarId),
    }).catch((e) =>
      log.error('processCandidate failed', {
        msgId: message.msgId,
        avatarId: candidate.avatarId,
        error: String(e),
      }),
    );
  }
}

/** 给手打的 @昵称补 mentions：没有显式 mention 的昵称，按昵称选分身/真人 */
async function resolveTextMentions(message: Message, members: MemberSnapshot[]): Promise<Message> {
  if (message.content.type !== 'text' || !message.content.text.includes('@')) return message;
  const ids = members.map((m) => m.principalId);
  if (ids.length === 0) return message;
  const [humans, avatars] = await Promise.all([
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids)),
    db.select({ id: avatar.id, name: avatar.name }).from(avatar).where(inArray(avatar.id, ids)),
  ]);
  const names = new Map<string, string>();
  for (const row of [...humans, ...avatars]) names.set(row.id, row.name);
  const mentions = resolveMentionIds({
    text: message.content.text,
    senderId: message.senderId,
    mentions: message.mentions,
    members,
    names,
  });
  return mentions.length === message.mentions.length ? message : { ...message, mentions };
}

/** P1 会话延续：读取最近 10 分钟消息，推导「回复链 / 同一发送者窗口」候选。 */
async function loadEngagement(
  message: Message,
  members: MemberSnapshot[],
  conv: { type: string; systemTag: string | null },
): Promise<EngagementContext> {
  const empty: EngagementContext = { replyToAvatarId: null, continuationAvatarIds: [] };
  if (message.senderType !== 'human' || conv.systemTag) return empty;
  const windowStart = new Date(Date.now() - CONTINUATION_WINDOW_MS);
  try {
    const rows = await db
      .select({
        msgId: messageTable.msgId,
        senderId: messageTable.senderId,
        senderType: messageTable.senderType,
        mentions: messageTable.mentions,
        replyTo: messageTable.replyTo,
        createdAt: messageTable.createdAt,
        content: messageTable.content,
      })
      .from(messageTable)
      .where(
        and(
          eq(messageTable.convId, message.convId),
          gte(messageTable.createdAt, windowStart),
          ne(messageTable.msgId, message.msgId),
        ),
      )
      .orderBy(desc(messageTable.seq))
      .limit(40);

    const recent: EngagementMessage[] = rows.reverse().map((r) => ({
      msgId: r.msgId,
      senderId: r.senderId,
      senderType: r.senderType,
      mentions: r.mentions ?? [],
      replyTo: r.replyTo,
      createdAt: r.createdAt,
      text: typeof r.content?.text === 'string' ? r.content.text : undefined,
    }));

    const replyIds = new Set<string>();
    if (message.replyTo) replyIds.add(message.replyTo);
    for (const r of recent) if (r.replyTo) replyIds.add(r.replyTo);

    let targets: { msgId: string; senderId: string; senderType: string }[] = [];
    if (replyIds.size > 0) {
      targets = await db
        .select({
          msgId: messageTable.msgId,
          senderId: messageTable.senderId,
          senderType: messageTable.senderType,
        })
        .from(messageTable)
        .where(inArray(messageTable.msgId, [...replyIds]));
    }
    const replyTargets = new Map<string, ReplyTarget>(
      targets.map((t) => [t.msgId, { senderId: t.senderId, senderType: t.senderType }]),
    );

    return deriveEngagement({
      message: {
        msgId: message.msgId,
        senderId: message.senderId,
        senderType: message.senderType,
        mentions: message.mentions ?? [],
        replyTo: message.replyTo ?? null,
        createdAt: new Date(message.createdAt),
        text: message.content.type === 'text' ? message.content.text : undefined,
      },
      recent,
      replyTargets,
      members,
      convType: conv.type,
    });
  } catch (e) {
    log.warn('engagement derive failed', { convId: message.convId, error: String(e) });
    return empty;
  }
}

async function processCandidate(params: {
  message: Message;
  classification: Classification;
  candidate: { avatarId: string; ownerId: string; mentioned: boolean; via: string };
  modelApproved?: boolean;
}): Promise<void> {
  const { message, classification, candidate, modelApproved } = params;

  // 幂等建立任务（UNIQUE(trigger_msg_id, avatar_id)）
  const taskId = newId('t');
  const traceId = newTraceId();
  const inserted = await db
    .insert(agentTask)
    .values({
      id: taskId,
      avatarId: candidate.avatarId,
      ownerId: candidate.ownerId,
      triggerMsgId: message.msgId,
      triggerConvId: message.convId,
      triggerKind: candidate.via,
      status: 'created',
      traceId,
    })
    .onConflictDoNothing({ target: [agentTask.triggerMsgId, agentTask.avatarId] })
    .returning({ id: agentTask.id });
  if (inserted.length === 0) return;

  await driveTask(
    {
      taskId,
      avatarId: candidate.avatarId,
      ownerId: candidate.ownerId,
      triggerMsgId: message.msgId,
      triggerConvId: message.convId,
      triggerKind: candidate.via,
      traceId,
    },
    message,
    { classification, modelApproved },
  );
}

/**
 * 驱动一个已落库的任务：策略 → 意图过滤 → 并发限制 → 租约 → runAgent。
 * 正常链路（processCandidate）与崩溃恢复（recovery.ts 分支 C）共用；
 * 恢复模式下策略/审批护栏全部重新生效。
 */
export async function driveTask(
  task: {
    taskId: string;
    avatarId: string;
    ownerId: string;
    triggerMsgId: string;
    triggerConvId: string;
    triggerKind: string;
    traceId: string;
  },
  trigger: Message,
  opts?: { classification?: Classification; recovery?: boolean; modelApproved?: boolean },
): Promise<void> {
  const classification =
    opts?.classification ?? classify(trigger.content.type === 'text' ? trigger.content.text : '');

  const convRows = await db
    .select({ id: conversation.id, type: conversation.type, systemTag: conversation.systemTag })
    .from(conversation)
    .where(eq(conversation.id, task.triggerConvId))
    .limit(1);
  const conv = convRows[0];
  if (!conv) return;

  const mentioned = trigger.mentions?.includes(task.avatarId) ?? false;
  const explicitReply = task.triggerKind === 'reply';
  const continuation = task.triggerKind === 'continuation';

  const skip = async (reason: string, extra?: Record<string, unknown>) => {
    await db
      .update(agentTask)
      .set({
        status: 'skipped',
        decision: { action: 'skip', reason, confidence: 0, ...extra },
        lockedBy: null,
        leaseUntil: null,
        updatedAt: sql`now()`,
      })
      .where(eq(agentTask.id, task.taskId));
    log.info('task skipped', { taskId: task.taskId, avatarId: task.avatarId, reason });
  };

  // 策略求值
  const policy = await evaluatePolicy({
    avatarId: task.avatarId,
    ownerId: task.ownerId,
    conv: { id: conv.id, type: conv.type, systemTag: conv.systemTag },
    senderType: trigger.senderType,
    senderUserId: trigger.senderType === 'human' ? trigger.senderId : null,
    mentioned,
    via: task.triggerKind as 'mention' | 'reply' | 'continuation' | 'direct' | 'auto' | 'self_chat',
    triggerMessageId: task.triggerMsgId,
    classification,
  });
  if (!policy.allow) {
    await skip(policy.reason, { escalate: policy.escalate, downgraded: policy.downgraded });
    // 禁区话题 → 提示主人一次
    if (policy.escalate) {
      const { internal } = await import('./common/internal');
      await internal
        .pushCard(task.ownerId, {
          kind: 'handover',
          taskId: task.taskId,
          summary: `有一条消息触及你的禁区策略（${policy.reason}），已转交你处理。`,
          reason: policy.reason,
        })
        .catch(() => undefined);
    }
    return;
  }

  // Pairwise 已在 processMessageCreated 完成角色匹配；这里只放行被选中的观察者。
  const effectiveClassification: Classification = opts?.modelApproved
    ? {
        ...classification,
        needReply: true,
        confidence: Math.max(classification.confidence, 0.9),
        summary: `${classification.summary} | pairwise role match`,
      }
    : classification;

  // 意图过滤：自动档只处理需要回应的消息（成本关键 —— 设计方案 §14）
  // 显式 @ / 回复 / 会话延续都属于「主人把对话交给分身」，不受意图过滤限制；
  // 延续仍受时间窗、轮次上限与其他真人插话的约束（见 engagement.ts）。
  if (
    !effectiveClassification.needReply &&
    !mentioned &&
    !explicitReply &&
    !continuation &&
    conv.systemTag !== 'avatar_self'
  ) {
    await skip('意图分类判定无需回应');
    return;
  }

  // 合理沉默：群聊 auto 档、未被 @、低置信度时不打扰
  if (
    config.silenceMinConfidence > 0 &&
    conv.type === 'group' &&
    conv.systemTag !== 'avatar_self' &&
    policy.mode === 'auto' &&
    !mentioned &&
    effectiveClassification.needReply &&
    effectiveClassification.confidence < config.silenceMinConfidence
  ) {
    const ownerRows = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, task.ownerId))
      .limit(1);
    const text = trigger.content.type === 'text' ? trigger.content.text : '';
    if (
      shouldStaySilent({
        convType: conv.type,
        systemTag: conv.systemTag,
        mode: policy.mode,
        mentioned,
        mentionsOwner: trigger.mentions?.includes(task.ownerId) ?? false,
        senderId: trigger.senderId,
        ownerId: task.ownerId,
        hasReply: Boolean(trigger.replyTo),
        urgency: effectiveClassification.urgency,
        sentiment: effectiveClassification.sentiment,
        topics: effectiveClassification.topics,
        text,
        ownerName: ownerRows[0]?.name ?? null,
        needReply: effectiveClassification.needReply,
        confidence: effectiveClassification.confidence,
        threshold: config.silenceMinConfidence,
      })
    ) {
      await skip('低置信度选择沉默', {
        intent: effectiveClassification.intent,
        intentConfidence: effectiveClassification.confidence,
        silence: true,
      });
      return;
    }
  }

  // 筛选策略：不自动代答，只把重要消息推给主人并记录。
  if (policy.strategy === 'screen') {
    const important =
      classification.importance === 'high' ||
      classification.importance === 'critical' ||
      mentioned ||
      explicitReply ||
      continuation ||
      policy.alwaysNotify;
    if (important) {
      const peerName =
        trigger.senderType === 'human'
          ? ((
              await db
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, trigger.senderId))
                .limit(1)
            )[0]?.name ?? '对方')
          : '对方';
      await internal
        .pushCard(task.ownerId, {
          kind: 'handover',
          taskId: task.taskId,
          summary: `筛选模式：${peerName} 的消息可能需要你处理。\n「${
            trigger.content.type === 'text' ? trigger.content.text.slice(0, 200) : ''
          }」`,
          reason: `importance=${classification.importance}`,
        })
        .catch(() => undefined);
    }
    await skip(important ? '筛选：重要消息已提醒主人' : '筛选：重要度较低，已记录', {
      screen: true,
      importance: classification.importance,
    });
    return;
  }

  // 静默值守 + 紧急穿透：不回复，但重要消息仍提醒主人。
  if (
    policy.strategy === 'silent' &&
    (policy.alwaysNotify ||
      classification.importance === 'high' ||
      classification.importance === 'critical')
  ) {
    await internal
      .pushCard(task.ownerId, {
        kind: 'handover',
        taskId: task.taskId,
        summary: `静默值守期间收到重要消息（${trigger.senderType === 'human' ? '真人' : '成员'}）：\n「${
          trigger.content.type === 'text' ? trigger.content.text.slice(0, 200) : ''
        }」`,
        reason: policy.alwaysNotify ? '紧急穿透联系人' : `importance=${classification.importance}`,
      })
      .catch(() => undefined);
  }

  // 分身并发限制（每分身 2 个并发任务）
  const semKey = aiKeys.semAvatar(task.avatarId);
  if (!(await redisSemaphoreAcquire(semKey, 2, 180))) {
    if (opts?.recovery) throw new SemaphoreFullError(task.taskId);
    await skip('分身并发任务已满，稍后处理');
    return;
  }

  try {
    // 条件迁移 + 租约：0 行 = 已被恢复进程认领/状态变更，本侧让位
    const moved = await db
      .update(agentTask)
      .set({
        status: 'planning',
        lockedBy: RUNTIME_ID,
        leaseUntil: sql`now() + ${LEASE_TTL_S} * interval '1 second'`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(agentTask.id, task.taskId), eq(agentTask.status, 'created')))
      .returning({ id: agentTask.id });
    if (moved.length === 0) return;

    await withLease(task.taskId, () =>
      runAgent({
        avatarId: task.avatarId,
        ownerId: task.ownerId,
        taskId: task.taskId,
        convId: task.triggerConvId,
        trigger,
        mode: policy.mode,
        strategy: policy.strategy,
        authorityVersion: policy.authorityVersion,
        via: task.triggerKind,
        allowCapabilities: policy.allowCapabilities,
        maxRisk: policy.maxRisk,
        classification: effectiveClassification,
        traceId: task.traceId,
        convType: conv.type as 'direct' | 'group',
      }),
    );
  } catch (e) {
    if (e instanceof LeaseLostError) {
      // 租约被恢复进程夺走：新主人正在驱动任务，本侧静默退出、不写状态
      log.warn('lease lost during task run', { taskId: task.taskId });
      return;
    }
    log.error('agent run failed', { taskId: task.taskId, error: redactSecrets(String(e)) });
    await db
      .update(agentTask)
      .set({
        status: 'failed',
        error: redactSecrets(String(e)).slice(0, 500),
        updatedAt: sql`now()`,
      })
      .where(and(eq(agentTask.id, task.taskId), eq(agentTask.lockedBy, RUNTIME_ID)))
      .catch(() => undefined);
  } finally {
    await redisSemaphoreRelease(semKey);
  }
}
