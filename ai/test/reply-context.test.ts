import { describe, expect, test } from 'bun:test';
import type { Message } from '@chappie/contract';
import { buildReplyContext } from '../src/reply-context';

function msg(
  msgId: string,
  senderId: string,
  senderType: string,
  text: string,
  createdAt: string,
  mentions: string[] = [],
  seq = 1,
): Message {
  return {
    msgId,
    convId: 'c1',
    clientMsgId: msgId,
    seq,
    senderId,
    senderType,
    onBehalfOf: null,
    content: { type: 'text', schemaVersion: 1, text },
    mentions,
    replyTo: null,
    aiMeta: null,
    recalled: false,
    createdAt,
  } as Message;
}

describe('reply context 序列化', () => {
  test('包含观察者、成员、时间、发送者和 @ 类型', () => {
    const text = buildReplyContext({
      convType: 'group',
      observer: { id: 'a_alice', name: 'alice', ownerName: 'alice', mode: 'auto' },
      members: [
        { principalId: 'u_alice', name: 'alice', principalType: 'human', ownerId: null },
        { principalId: 'a_alice', name: 'alice', principalType: 'avatar', ownerId: 'u_alice' },
        { principalId: 'u_bob', name: 'bob', principalType: 'human', ownerId: null },
        { principalId: 'a_bob', name: 'bob', principalType: 'avatar', ownerId: 'u_bob' },
      ],
      messages: [
        msg('m1', 'u_bob', 'human', '明天中午外滩集合', '2026-11-26T10:01:00+08:00', [], 1),
        msg('m2', 'a_bob', 'avatar', '收到', '2026-11-26T10:02:00+08:00', [], 2),
      ],
      trigger: msg(
        'm3',
        'u_bob',
        'human',
        '@alice 你帮我也记一下',
        '2026-11-26T10:03:00+08:00',
        ['a_alice'],
        3,
      ),
    });
    expect(text).toContain('[群聊]');
    expect(text).toContain('观察者：alice 的 AI 分身（主人：alice；模式：auto）');
    expect(text).toMatch(/\[..:..\] bob\(真人\)：明天中午外滩集合/);
    expect(text).toMatch(/\[..:..\] bob\(真人\)：@alice 你帮我也记一下（@alice·分身）/);
    expect(text).toContain('请判断：观察者是否应该回复当前消息？');
  });
});
