/** RealtimeClient：首帧鉴权、发送门控、帧分发、鉴权失败、断线重连（假 WebSocket）。 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerFrame } from '@chappie/contract';
import { RealtimeClient, type RealtimeStatus } from '../src/ws';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState !== FakeWebSocket.CLOSED) {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  // ---- 测试驱动 ----
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  sentFrames(): { type: string }[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const originalWebSocket = globalThis.WebSocket;

beforeAll(() => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterAll(() => {
  globalThis.WebSocket = originalWebSocket;
});

beforeEach(() => {
  FakeWebSocket.instances = [];
});

function makeClient(overrides: { onAuthError?: (m: string) => void } = {}) {
  const frames: ServerFrame[] = [];
  const statuses: RealtimeStatus[] = [];
  const client = new RealtimeClient({
    url: 'ws://test/ws',
    token: 'tok',
    platform: 'web',
    handlers: {
      onFrame: (f) => frames.push(f),
      onStatus: (s) => statuses.push(s),
      onAuthError: overrides.onAuthError,
    },
  });
  return { client, frames, statuses };
}

describe('RealtimeClient', () => {
  test('连接后首帧必须是 auth；鉴权前禁止发送业务帧', () => {
    const { client, statuses } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    expect(statuses).toEqual(['connecting']);

    ws.open();
    expect(ws.sentFrames()[0]).toMatchObject({ type: 'auth', token: 'tok', platform: 'web' });

    client.send({ type: 'heartbeat', ts: 1 });
    expect(ws.sent).toHaveLength(1); // 未鉴权，业务帧被丢弃
    expect(client.isOpen).toBe(false);
    client.close();
  });

  test('auth_ok 后状态为 open、允许发送并分发服务端帧', () => {
    const { client, frames, statuses } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.receive({ type: 'auth_ok', user: {}, serverTime: new Date().toISOString() });

    expect(client.isOpen).toBe(true);
    expect(statuses).toEqual(['connecting', 'open']);

    client.send({ type: 'heartbeat', ts: 2 });
    expect(ws.sentFrames().at(-1)).toMatchObject({ type: 'heartbeat', ts: 2 });

    ws.receive({
      type: 'typing',
      convId: 'c1',
      principalId: 'u1',
      untilTs: 1,
    });
    expect(frames.at(-1)).toMatchObject({ type: 'typing', convId: 'c1' });
    client.close();
  });

  test('非法 JSON 帧被忽略，不抛错', () => {
    const { client, frames } = makeClient();
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.receive({ type: 'auth_ok', user: {}, serverTime: '' });
    ws.onmessage?.({ data: '{not json' });
    expect(frames.some((f) => f.type === 'typing')).toBe(false);
    client.close();
  });

  test('auth_error 触发回调并关闭连接', () => {
    const errors: string[] = [];
    const { client, statuses } = makeClient({ onAuthError: (m) => errors.push(m) });
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.receive({ type: 'auth_error', message: 'token expired' });

    expect(errors).toEqual(['token expired']);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(statuses.at(-1)).toBe('closed');
    client.close();
  });

  test('被动断线后按退避重连；主动关闭不再重连', async () => {
    const { client } = makeClient();
    client.connect();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive({ type: 'auth_ok', user: {}, serverTime: '' });

    first.onclose?.(); // 模拟网络断开
    expect(FakeWebSocket.instances).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1100));
    expect(FakeWebSocket.instances.length).toBe(2);
    expect(FakeWebSocket.instances[1]?.url).toBe('ws://test/ws');

    client.close();
    expect(FakeWebSocket.instances[1]?.readyState).toBe(FakeWebSocket.CLOSED);
    // 主动关闭后不再新建连接
    FakeWebSocket.instances[1]?.onclose?.();
    await new Promise((r) => setTimeout(r, 50));
    expect(FakeWebSocket.instances).toHaveLength(2);
  }, 5000);
});
