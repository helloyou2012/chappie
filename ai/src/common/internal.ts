/**
 * 调用 im-core 内部 API（HTTP JSON，X-Internal-Token 鉴权）。
 * 对应设计方案 §25.5 六接口 + 账号生命周期补充接口。
 */

import type { CardPayload, Content, MemberView, Message } from '@chappie/contract';
import { config } from './config';

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
}

export interface PresenceInfo {
  userId: string;
  online: boolean;
  typingConvId: string | null;
}

export const internal = {
  verifyToken: (token: string) => call<{ userId: string }>('/internal/v1/verify-token', { token }),

  sendMessage: (req: SendMessageInternalReq, traceId?: string) =>
    call<Message>('/internal/v1/send-message', req, traceId),

  recallMessage: (msgId: string, actorId: string) =>
    call<{ ok: boolean }>('/internal/v1/recall-message', { msgId, actorId }),

  getContext: (convId: string, limit = 20) =>
    call<{ messages: Message[]; members: MemberView[] }>('/internal/v1/get-context', {
      convId,
      limit,
    }),

  getPresence: (userIds: string[]) =>
    call<PresenceInfo[]>('/internal/v1/get-presence', { userIds }),

  pushCard: (recipientUserId: string, card: CardPayload, targetConvId?: string) =>
    call<{ msgId: string }>('/internal/v1/push-card', { recipientUserId, card, targetConvId }),

  updateCard: (msgId: string, card: CardPayload) =>
    call<Message>('/internal/v1/update-card', { msgId, card }),

  freezeAvatar: (avatarId: string, frozen: boolean) =>
    call<{ ok: boolean; status: string }>('/internal/v1/freeze-avatar', { avatarId, frozen }),

  createAvatar: (ownerId: string, name: string) =>
    call<{ avatarId: string }>('/internal/v1/create-avatar', { ownerId, name }),

  createConversation: (req: {
    type: 'direct' | 'group';
    memberPrincipalIds: string[];
    title?: string | null;
    systemTag?: string | null;
  }) => call<{ convId: string }>('/internal/v1/create-conversation', req),
};
