/**
 * WebSocket 实时客户端：首帧鉴权、25s 心跳、指数退避重连、seq 断洞补拉。
 * Web / Tauri / React Native 均可用（只用全局 WebSocket）。
 */

import type { ClientFrame, Content, ServerFrame } from '@chappie/contract';
import { uuid } from './format';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

export interface RealtimeHandlers {
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: RealtimeStatus) => void;
  onAuthError?: (message: string) => void;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private authed = false;

  constructor(
    private opts: {
      url: string;
      token: string;
      platform: string;
      handlers: RealtimeHandlers;
    },
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    if (this.closedByUser) return;
    this.opts.handlers.onStatus('connecting');
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.sendRaw({ type: 'auth', token: this.opts.token, platform: this.opts.platform });
    };

    ws.onmessage = (ev: MessageEvent) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ServerFrame;
      } catch {
        return;
      }
      if (frame.type === 'auth_ok') {
        this.authed = true;
        this.opts.handlers.onStatus('open');
        this.startHeartbeat();
      } else if (frame.type === 'auth_error') {
        this.opts.handlers.onAuthError?.(frame.message);
        this.close();
        return;
      }
      this.opts.handlers.onFrame(frame);
    };

    ws.onclose = () => {
      this.authed = false;
      this.stopHeartbeat();
      this.opts.handlers.onStatus('closed');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose 会随之触发 */
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 15000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.send({ type: 'heartbeat', ts: Date.now() }),
      25_000,
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  send(frame: ClientFrame): void {
    if (this.ws && this.authed && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private sendRaw(frame: unknown): void {
    this.ws?.send(JSON.stringify(frame));
  }

  sendMessage(
    convId: string,
    content: Content,
    opts?: { mentions?: string[]; replyTo?: string | null; clientMsgId?: string },
  ): string {
    const clientMsgId = opts?.clientMsgId ?? `cm_${uuid()}`;
    this.send({
      type: 'send_message',
      clientMsgId,
      convId,
      content,
      mentions: opts?.mentions ?? [],
      replyTo: opts?.replyTo ?? null,
    });
    return clientMsgId;
  }

  typing(convId: string): void {
    this.send({ type: 'typing', convId });
  }

  markRead(convId: string, seq: number): void {
    this.send({ type: 'mark_read', convId, seq });
  }

  recall(msgId: string): void {
    this.send({ type: 'recall_message', msgId });
  }

  pullMessages(convId: string, fromSeq: number, limit = 100): void {
    this.send({ type: 'pull_messages', convId, fromSeq, limit });
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.opts.handlers.onStatus('closed');
  }

  get isOpen(): boolean {
    return this.authed;
  }
}
