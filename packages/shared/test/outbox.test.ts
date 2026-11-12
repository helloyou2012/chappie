/** 离线命令队列：持久化、去重、作用域隔离、ack 移除（纯内存适配器）。 */
import { describe, expect, test } from 'bun:test';
import type { Content } from '@chappie/contract';
import { CommandOutbox } from '../src/outbox';
import type { StorageLike } from '../src/storage';

function memoryAdapter(): StorageLike & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (k) => dump.get(k) ?? null,
    setItem: (k, v) => void dump.set(k, v),
    removeItem: (k) => void dump.delete(k),
  };
}

const text = (t: string): Content => ({ type: 'text', schemaVersion: 1, text: t });

const cmd = (clientMsgId: string, convId = 'c1') => ({
  clientMsgId,
  convId,
  content: text(`消息 ${clientMsgId}`),
  mentions: [] as string[],
  replyTo: null,
});

describe('CommandOutbox', () => {
  test('入队、读取、去重', async () => {
    const outbox = new CommandOutbox('u1', memoryAdapter());
    await outbox.enqueue(cmd('cm_1'));
    await outbox.enqueue(cmd('cm_1'));
    await outbox.enqueue(cmd('cm_2'));

    const list = await outbox.list();
    expect(list.map((c) => c.clientMsgId)).toEqual(['cm_1', 'cm_2']);
    expect(list.every((c) => c.attempts === 0)).toBe(true);
  });

  test('新实例复用同一存储，保持队列', async () => {
    const adapter = memoryAdapter();
    const first = new CommandOutbox('u1', adapter);
    await first.enqueue(cmd('cm_persist'));

    const second = new CommandOutbox('u1', adapter);
    expect((await second.list()).map((c) => c.clientMsgId)).toEqual(['cm_persist']);
  });

  test('ack 后移除；markAttempt 增加重试次数', async () => {
    const outbox = new CommandOutbox('u1', memoryAdapter());
    await outbox.enqueue(cmd('cm_1'));
    await outbox.enqueue(cmd('cm_2'));

    await outbox.markAttempt('cm_1');
    await outbox.markAttempt('cm_1');
    const after = await outbox.list();
    expect(after.find((c) => c.clientMsgId === 'cm_1')?.attempts).toBe(2);

    await outbox.remove('cm_1');
    expect((await outbox.list()).map((c) => c.clientMsgId)).toEqual(['cm_2']);

    await outbox.remove('cm_2');
    expect(await outbox.list()).toEqual([]);
  });

  test('不同用户 scope 隔离', async () => {
    const adapter = memoryAdapter();
    const alice = new CommandOutbox('u_alice', adapter);
    const bob = new CommandOutbox('u_bob', adapter);

    await alice.enqueue(cmd('cm_a'));
    expect((await bob.list()).length).toBe(0);
    expect((await alice.list()).length).toBe(1);
  });

  test('损坏的存储内容按空队列处理', async () => {
    const adapter = memoryAdapter();
    adapter.dump.set('chappie.outbox.v1.u1', '{not-json');
    const outbox = new CommandOutbox('u1', adapter);
    expect(await outbox.list()).toEqual([]);
  });
});
