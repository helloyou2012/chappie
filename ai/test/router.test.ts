/** 触发路由（纯函数）—— 设计方案 §4.4 第 1 步、§29.6 防 AI 互聊死循环。 */
import { describe, expect, test } from 'bun:test';
import type { Message } from '@chappie/contract';
import { findCandidates, type MemberSnapshot } from '../src/router';

const MEMBERS: MemberSnapshot[] = [
  { principalId: 'u_alice', principalType: 'human', ownerId: null },
  { principalId: 'u_bob', principalType: 'human', ownerId: null },
  { principalId: 'a_alice', principalType: 'avatar', ownerId: 'u_alice' },
  { principalId: 'a_bob', principalType: 'avatar', ownerId: 'u_bob' },
];

function msg(opts: Partial<Message> = {}): Message {
  return {
    msgId: 'm_1',
    convId: 'c_1',
    seq: 1,
    senderId: 'u_alice',
    senderType: 'human',
    content: { type: 'text', schemaVersion: 1, text: 'hi' },
    mentions: [],
    createdAt: new Date().toISOString(),
    ...opts,
  } as Message;
}

const direct = { id: 'c_1', type: 'direct', systemTag: null };
const group = { id: 'c_1', type: 'group', systemTag: null };
const selfChat = { id: 'c_1', type: 'direct', systemTag: 'avatar_self' };

describe('findCandidates 系统会话（主人 ↔ 分身）', () => {
  test('主人消息 → 自己的分身，via=self_chat 且视为被 @', () => {
    const list = findCandidates(msg({ senderId: 'u_alice' }), MEMBERS, selfChat);
    expect(list).toEqual([
      { avatarId: 'a_alice', ownerId: 'u_alice', mentioned: true, via: 'self_chat' },
    ]);
  });

  test('分身 / 系统消息不触发', () => {
    expect(
      findCandidates(msg({ senderType: 'avatar', senderId: 'a_alice' }), MEMBERS, selfChat),
    ).toEqual([]);
    expect(findCandidates(msg({ senderType: 'system' }), MEMBERS, selfChat)).toEqual([]);
  });
});

describe('findCandidates 普通会话', () => {
  test('私聊人类消息 → 对方主人的分身，via=direct', () => {
    const list = findCandidates(msg({ senderId: 'u_alice' }), MEMBERS, direct);
    expect(list).toEqual([
      { avatarId: 'a_bob', ownerId: 'u_bob', mentioned: false, via: 'direct' },
    ]);
  });

  test('群聊人类消息 → 其他成员的分身，via=auto', () => {
    const list = findCandidates(msg({ senderId: 'u_alice' }), MEMBERS, group);
    expect(list).toEqual([{ avatarId: 'a_bob', ownerId: 'u_bob', mentioned: false, via: 'auto' }]);
  });

  test('被 @ 的分身总是候选（群聊 via=mention）', () => {
    const list = findCandidates(msg({ senderId: 'u_alice', mentions: ['a_bob'] }), MEMBERS, group);
    expect(list).toEqual([
      { avatarId: 'a_bob', ownerId: 'u_bob', mentioned: true, via: 'mention' },
    ]);
  });

  test('@ 自己主人的分身不触发（避免自问自答）', () => {
    const list = findCandidates(
      msg({ senderId: 'u_alice', mentions: ['a_alice'] }),
      MEMBERS,
      group,
    );
    expect(list.map((c) => c.avatarId)).not.toContain('a_alice');
  });

  test('@ 与自动候选合并去重，mentioned 优先为 true', () => {
    const list = findCandidates(msg({ senderId: 'u_alice', mentions: ['a_bob'] }), MEMBERS, group);
    expect(list.filter((c) => c.avatarId === 'a_bob')).toHaveLength(1);
    expect(list[0]?.mentioned).toBe(true);
  });

  test('私聊中分身消息 → 对方分身响应（AI 对 AI 仅限对话另一方）', () => {
    const list = findCandidates(
      msg({ senderId: 'a_alice', senderType: 'avatar' }),
      MEMBERS,
      direct,
    );
    expect(list).toEqual([
      { avatarId: 'a_bob', ownerId: 'u_bob', mentioned: false, via: 'direct' },
    ]);
  });

  test('群聊中分身消息未 @ 任何人 → 无候选（防互聊死循环）', () => {
    expect(
      findCandidates(msg({ senderId: 'a_alice', senderType: 'avatar' }), MEMBERS, group),
    ).toEqual([]);
  });

  test('未知发送者与无本人分身的成员被安全忽略', () => {
    const members = [...MEMBERS, { principalId: 'u_carol', principalType: 'human', ownerId: null }];
    const list = findCandidates(msg({ senderId: 'u_unknown' }), members, group);
    expect(list.map((c) => c.avatarId).sort()).toEqual(['a_alice', 'a_bob']);
  });
});
