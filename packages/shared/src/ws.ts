/**
 * WebSocket 实时客户端：首帧鉴权、25s 心跳、指数退避重连、seq 断洞补拉。
 * Web / Tauri / React Native 均可用（只用全局 WebSocket）。
 */

import type { ClientFrame, Content, DeviceCapabilities, ServerFrame } from '@chappie/contract';
import { uuid } from './format';
import type { CommandOutbox } from './outbox';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

export interface RealtimeHandlers {
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: RealtimeStatus) => void;
  onAuthError?: (message: string) => void;
  /** 服务端 epoch 变化（进程重启）时回调，客户端可据此重新拉快照 */
  onServerEpoch?: (epoch: string) => void;
}

export interface RealtimeDeviceInfo {
  deviceId?: string;
  appVersion?: string;
  capabilities?: DeviceCapabilities;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private authed = false;
  private serverEpoch: string | null = null;
  private flushing = false;

  constructor(
    private opts: {
      url: string;
      token: string;
      platform: string;
      device?: RealtimeDeviceInfo;
      /** 离线命令队列；提供后所有发送先入队，ack/消息对账后移除 */
      outbox?: CommandOutbox;
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
      this.sendRaw({
        type: 'auth',
        token: this.opts.token,
        platform: this.opts.platform,
        ...(this.opts.device?.deviceId ? { deviceId: this.opts.device.deviceId } : {}),
        ...(this.opts.device?.appVersion ? { appVersion: this.opts.device.appVersion } : {}),
        ...(this.opts.device?.capabilities ? { capabilities: this.opts.device.capabilities } : {}),
      });
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
        if (this.serverEpoch && this.serverEpoch !== frame.serverEpoch) {
          this.opts.handlers.onServerEpoch?.(frame.serverEpoch);
        }
        this.serverEpoch = frame.serverEpoch;
        this.opts.handlers.onStatus('open');
        this.startHeartbeat();
        void this.flushOutbox().catch(() => undefined);
      } else if (frame.type === 'auth_error') {
        this.opts.handlers.onAuthError?.(frame.message);
        this.close();
        return;
      }
      // 服务端确认（ack 或广播）后，离线队列中的同一条命令即可移除
      if (frame.type === 'message_acked') {
        void this.opts.outbox?.remove(frame.clientMsgId).catch(() => undefined);
      } else if (frame.type === 'message_created' && frame.message.clientMsgId) {
        void this.opts.outbox?.remove(frame.message.clientMsgId).catch(() => undefined);
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
    const command = {
      type: 'send_message' as const,
      clientMsgId,
      convId,
      content,
      mentions: opts?.mentions ?? [],
      replyTo: opts?.replyTo ?? null,
    };
    if (this.opts.outbox) {
      void this.enqueueAndFlush(command).catch(() => undefined);
    } else {
      this.send(command);
    }
    return clientMsgId;
  }

  private async enqueueAndFlush(command: {
    clientMsgId: string;
    convId: string;
    content: Content;
    mentions: string[];
    replyTo: string | null;
  }): Promise<void> {
    await this.opts.outbox?.enqueue(command);
    await this.flushOutbox();
  }

  /** 重放离线队列；服务端用 clientMsgId 幂等，重复重放安全。 */
  async flushOutbox(): Promise<void> {
    const outbox = this.opts.outbox;
    if (!outbox || !this.authed || this.flushing) return;
    this.flushing = true;
    try {
      const queue = await outbox.list();
      for (const cmd of queue) {
        if (!this.authed || !this.ws || this.ws.readyState !== 1) break;
        this.sendRaw({
          type: 'send_message',
          clientMsgId: cmd.clientMsgId,
          convId: cmd.convId,
          content: cmd.content,
          mentions: cmd.mentions,
          replyTo: cmd.replyTo,
        });
        await outbox.markAttempt(cmd.clientMsgId);
      }
    } finally {
      this.flushing = false;
    }
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
