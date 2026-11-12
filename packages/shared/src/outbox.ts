/**
 * 离线命令队列（客户端 outbox）。
 *
 * 端云一体的弱网保障：
 *   - 发送消息先入队并持久化，再尝试通过 WS 发送；
 *   - 断线/冷启动后，鉴权成功自动重放；
 *   - 服务端用 clientMsgId 幂等，重复重放不会产生重复消息；
 *   - 收到 ack 或带相同 clientMsgId 的消息后，从队列移除。
 *
 * 队列按用户 scope 隔离，避免切换账号后把上一个人的消息发出去。
 */

import type { Content } from '@chappie/contract';
import { getStorage, type StorageLike } from './storage';

export interface QueuedCommand {
  clientMsgId: string;
  convId: string;
  content: Content;
  mentions: string[];
  replyTo: string | null;
  createdAt: string;
  attempts: number;
}

const MAX_QUEUE = 100;

function outboxKey(scope: string): string {
  return `chappie.outbox.v1.${scope}`;
}

function isQueuedCommand(value: unknown): value is QueuedCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.clientMsgId === 'string' &&
    typeof v.convId === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.attempts === 'number' &&
    v.content !== undefined
  );
}

function parseQueue(raw: string | null): QueuedCommand[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedCommand).map((cmd) => ({
      ...cmd,
      mentions: Array.isArray(cmd.mentions) ? cmd.mentions : [],
      replyTo: cmd.replyTo ?? null,
    }));
  } catch {
    return [];
  }
}

export class CommandOutbox {
  /** 串行化读写，避免并发 enqueue/remove 互相覆盖 */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly scope = 'anonymous',
    private readonly storage: StorageLike = getStorage(),
  ) {}

  private async read(): Promise<string | null> {
    return (await this.storage.getItem(outboxKey(this.scope))) ?? null;
  }

  private async write(value: string): Promise<void> {
    await this.storage.setItem(outboxKey(this.scope), value);
  }

  private async removeKey(): Promise<void> {
    await this.storage.removeItem(outboxKey(this.scope));
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async list(): Promise<QueuedCommand[]> {
    return this.run(async () => parseQueue(await this.read()));
  }

  async enqueue(
    cmd: Omit<QueuedCommand, 'createdAt' | 'attempts'> & { createdAt?: string },
  ): Promise<void> {
    await this.run(async () => {
      const queue = parseQueue(await this.read());
      if (queue.some((c) => c.clientMsgId === cmd.clientMsgId)) return;
      queue.push({
        ...cmd,
        createdAt: cmd.createdAt ?? new Date().toISOString(),
        attempts: 0,
      });
      await this.write(JSON.stringify(queue.slice(-MAX_QUEUE)));
    });
  }

  async remove(clientMsgId: string): Promise<void> {
    await this.run(async () => {
      const queue = parseQueue(await this.read());
      const next = queue.filter((c) => c.clientMsgId !== clientMsgId);
      if (next.length === queue.length) return;
      if (next.length === 0) {
        await this.removeKey();
      } else {
        await this.write(JSON.stringify(next));
      }
    });
  }

  async markAttempt(clientMsgId: string): Promise<void> {
    await this.run(async () => {
      const queue = parseQueue(await this.read());
      let changed = false;
      const next = queue.map((c) => {
        if (c.clientMsgId !== clientMsgId) return c;
        changed = true;
        return { ...c, attempts: c.attempts + 1 };
      });
      if (changed) await this.write(JSON.stringify(next));
    });
  }

  async clear(): Promise<void> {
    await this.run(async () => {
      await this.removeKey();
    });
  }
}
