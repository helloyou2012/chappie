/**
 * 调用 im-core 内部 API（HTTP JSON，X-Internal-Token 鉴权）。
 * 对应设计方案 §25.5 六接口 + 账号生命周期补充接口。
 */

import type { CardPayload, Content, MemberView, Message, ReceptionView } from '@chappie/contract';
import { config } from './config';
import { notifyForCard } from './push';

export class InternalApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    path: string,
  ) {
    super(`internal call ${path} failed: ${status} ${body}`);
    this.name = 'InternalApiError';
  }

  get isHopLimitExceeded(): boolean {
    return this.body.includes('HOP_LIMIT_EXCEEDED');
  }
}

async function call<T>(path: string, body: unknown, traceId?: string | null): Promise<T> {
  const res = await fetch(`${config.internalBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': config.internalToken,
      ...(traceId ? { 'x-trace-id': traceId } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new InternalApiError(res.status, await res.text().catch(() => ''), path);
  }
  return (await res.json()) as T;
}

export interface SendMessageInternalReq {
  clientMsgId: string;
  convId: string;
  senderId: string;
  onBehalfOf: string | null;
  content: Content;
  mentions?: string[];
  replyTo?: string | null;
  aiMeta?: Record<string, unknown> | null;
  authorityVersion?: number;
  via?: string | null;
  /** 流式消息：先只对主人可见，通过 updateStreamText / finalizeStreamMessage 推进 */
  streaming?: boolean;
}

export interface PresenceInfo {
  userId: string;
  online: boolean;
  typingConvId: string | null;
}

export interface DeviceInfo {
  deviceId: string;
  platform: string;
  appVersion: string | null;
  capabilities: Record<string, boolean>;
  pushToken: string | null;
  updatedAt: string;
}

export const internal = {
  verifyToken: (token: string) => call<{ userId: string }>('/internal/v1/verify-token', { token }),

  sendMessage: (req: SendMessageInternalReq, traceId?: string) =>
    call<Message>('/internal/v1/send-message', req, traceId),

  recallMessage: (msgId: string, actorId: string) =>
    call<{ ok: boolean }>('/internal/v1/recall-message', { msgId, actorId }),

  getContext: (convId: string, limit = 20, ownerId?: string) =>
    call<{ messages: Message[]; members: MemberView[]; reception?: ReceptionView }>(
      '/internal/v1/get-context',
      { convId, limit, ownerId },
    ),

  getReception: (convId: string, ownerId: string) =>
    call<ReceptionView>('/internal/v1/get-reception', { convId, ownerId }),

  setReception: (req: {
    ownerId: string;
    convId: string;
    state: string;
    strategy: string;
    until?: string | null;
    reason?: string;
  }) => call<ReceptionView>('/internal/v1/set-reception', req),

  resolveHumanRequest: (ownerId: string, requestId: string, approve: boolean) =>
    call<{ ok: boolean }>('/internal/v1/resolve-human-request', {
      ownerId,
      requestId,
      approve,
    }),

  getPresence: (userIds: string[]) =>
    call<PresenceInfo[]>('/internal/v1/get-presence', { userIds }),

  /** 广播分身「正在输入」状态；ttlMs=0 表示立即清除（任务结束） */
  typing: (convId: string, principalId: string, ttlMs = 20_000) =>
    call<{ ok: boolean }>('/internal/v1/typing', { convId, principalId, ttlMs }),

  /** 查询用户设备与端侧能力清单（Agent 决定可用端侧动作） */
  getDevices: (userId: string) =>
    call<{ devices: DeviceInfo[] }>('/internal/v1/get-devices', { userId }),

  /**
   * 推卡片给主人（落库为消息，经 WS 实时投递）。
   * 成功后 fire-and-forget 触发推送通知（approval / handover / 日程提醒 / 日报）——
   * 唯一推送入口，业务模块不各自发推送（design-essence §8）。
   */
  async pushCard(recipientUserId: string, card: CardPayload, targetConvId?: string) {
    const res = await call<{ msgId: string }>('/internal/v1/push-card', {
      recipientUserId,
      card,
      targetConvId,
    });
    void notifyForCard(recipientUserId, card);
    return res;
  },

  updateCard: (msgId: string, card: CardPayload) =>
    call<Message>('/internal/v1/update-card', { msgId, card }),

  /** 流式增量：用累积的完整文本/思考/工具活动替换内容（仅主人可见，持久化） */
  updateStreamText: (
    msgId: string,
    text: string,
    thinking?: string,
    activity?: Record<string, unknown>[],
  ) => call<Message>('/internal/v1/update-stream-text', { msgId, text, thinking, activity }),

  /** 流式定稿：visible=true 才对外广播并进入 AI 事件链路；text 缺省 = 保留当前内容 */
  finalizeStreamMessage: (req: {
    msgId: string;
    text?: string | null;
    aiMeta?: Record<string, unknown> | null;
    visible: boolean;
  }) => call<Message>('/internal/v1/finalize-stream-message', req),

  freezeAvatar: (avatarId: string, frozen: boolean) =>
    call<{ ok: boolean; status: string }>('/internal/v1/freeze-avatar', { avatarId, frozen }),

  updateAvatarName: (avatarId: string, name: string) =>
    call<{ ok: boolean }>('/internal/v1/update-avatar-name', { avatarId, name }),

  createAvatar: (ownerId: string, name: string) =>
    call<{ avatarId: string }>('/internal/v1/create-avatar', { ownerId, name }),

  createConversation: (req: {
    type: 'direct' | 'group';
    memberPrincipalIds: string[];
    title?: string | null;
    systemTag?: string | null;
  }) => call<{ convId: string }>('/internal/v1/create-conversation', req),
};
