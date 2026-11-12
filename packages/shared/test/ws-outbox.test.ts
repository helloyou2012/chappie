/** WS 离线队列：鉴权后自动重放、ack 后移除（Fake WebSocket，不依赖网络）。 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fixtures } from '@chappie/contract';
import { CommandOutbox } from '../src/outbox';
import type { StorageLike } from '../src/storage';
import { RealtimeClient } from '../src/ws';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function memoryAdapter(): StorageLike {
  const dump = new Map<string, string>();
  return {
    getItem: (k) => dump.get(k) ?? null,
    setItem: (k, v) => void dump.set(k, v),
    removeItem: (k) => void dump.delete(k),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe('RealtimeClient 离线队列', () => {
  test('鉴权成功后自动重放 send_message，ack 后移除', async () => {
    const outbox = new CommandOutbox('u_test', memoryAdapter());
    await outbox.enqueue({
      clientMsgId: 'cm_offline_1',
      convId: 'c_1',
      content: { type: 'text', schemaVersion: 1, text: '离线时发的消息' },
      mentions: [],
      replyTo: null,
    });

    const client = new RealtimeClient({
      url: 'ws://test',
      token: 'tok',
      platform: 'web',
      outbox,
      handlers: {
        onFrame: () => undefined,
        onStatus: () => undefined,
      },
    });
    client.connect();

    const ws = FakeWebSocket.instances.at(-1);
    expect(ws).toBeDefined();
    ws!.open();
    expect(ws!.frames()[0]?.type).toBe('auth');

    ws!.receive({
      type: 'auth_ok',
      user: fixtures.user,
      serverTime: '2026-11-11T02:00:00.000Z',
      serverEpoch: 'epoch_1',
    });
    await tick();
    await tick();

    const sent = ws!.frames().filter((f) => f.type === 'send_message');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.clientMsgId).toBe('cm_offline_1');
    expect((await outbox.list()).length).toBe(1); // 尚未 ack

    ws!.receive({
      type: 'message_acked',
      clientMsgId: 'cm_offline_1',
      msgId: 'm_1',
      seq: 1,
      serverTime: '2026-11-11T02:00:00.000Z',
    });
    await tick();
    await tick();
    expect(await outbox.list()).toEqual([]);

    client.close();
  });

  test('message_created 携带 clientMsgId 也能移除队列', async () => {
    const outbox = new CommandOutbox('u_test', memoryAdapter());
    await outbox.enqueue({
      clientMsgId: 'cm_offline_2',
      convId: 'c_1',
      content: { type: 'text', schemaVersion: 1, text: 'hi' },
      mentions: [],
      replyTo: null,
    });

    const client = new RealtimeClient({
      url: 'ws://test',
      token: 'tok',
      platform: 'web',
      outbox,
      handlers: {
        onFrame: () => undefined,
        onStatus: () => undefined,
      },
    });
    client.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.receive({
      type: 'auth_ok',
      user: fixtures.user,
      serverTime: '2026-11-11T02:00:00.000Z',
      serverEpoch: 'epoch_1',
    });
    await tick();

    ws.receive({
      type: 'message_created',
      message: { ...fixtures.humanMessage, clientMsgId: 'cm_offline_2' },
    });
    await tick();
    await tick();
    expect(await outbox.list()).toEqual([]);

    client.close();
  });
});
