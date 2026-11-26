import { describe, expect, test } from 'bun:test';
import { type MentionMember, resolveMentionIds } from '../src/mentions';

const humanAlice = { principalId: 'u_alice', principalType: 'human', ownerId: null };
const avatarAlice = { principalId: 'a_alice', principalType: 'avatar', ownerId: 'u_alice' };
const humanBob = { principalId: 'u_bob', principalType: 'human', ownerId: null };
const avatarBob = { principalId: 'a_bob', principalType: 'avatar', ownerId: 'u_bob' };
const members: MentionMember[] = [humanAlice, avatarAlice, humanBob, avatarBob];
const names = new Map([
  ['u_alice', 'alice'],
  ['a_alice', 'alice'],
  ['u_bob', 'bob'],
  ['a_bob', 'bob'],
]);

function resolve(text: string, mentions: string[] = [], senderId = 'u_alice') {
  return resolveMentionIds({ text, mentions, members, names, senderId });
}

describe('@昵称解析', () => {
  test('手动 @alice：优先发送者自己的分身', () => {
    expect(resolve('@alice 你帮我也记一下')).toEqual(['a_alice']);
  });

  test('@bob：选择 bob 的分身', () => {
    expect(resolve('@bob 你也记一下')).toEqual(['a_bob']);
  });

  test('显式选中真人时不被分身覆盖', () => {
    expect(resolve('@alice 你看下', ['u_alice'])).toEqual(['u_alice']);
  });

  test('显式选中分身时不重复', () => {
    expect(resolve('@alice 你看下', ['a_alice'])).toEqual(['a_alice']);
  });

  test('邮箱里的 @ 不算提及', () => {
    expect(resolve('发到 foo@alice.com')).toEqual([]);
  });

  test('最长昵称优先', () => {
    const m = [
      { principalId: 'a_short', principalType: 'avatar', ownerId: 'u_x' },
      { principalId: 'a_long', principalType: 'avatar', ownerId: 'u_y' },
    ];
    const n = new Map([
      ['a_short', '小明'],
      ['a_long', '小明子'],
    ]);
    expect(
      resolveMentionIds({
        text: '@小明子 你好',
        mentions: [],
        members: m,
        names: n,
        senderId: 'u_x',
      }),
    ).toEqual(['a_long']);
  });

  test('中文名后无空格也能解析', () => {
    const m = [{ principalId: 'a_xm', principalType: 'avatar', ownerId: 'u_x' }];
    const n = new Map([['a_xm', '小明']]);
    expect(
      resolveMentionIds({
        text: '@小明你去吗',
        mentions: [],
        members: m,
        names: n,
        senderId: 'u_z',
      }),
    ).toEqual(['a_xm']);
  });

  test('只有真人时解析到真人（AI 不抢答）', () => {
    const m = [{ principalId: 'u_carol', principalType: 'human', ownerId: null }];
    const n = new Map([['u_carol', 'carol']]);
    expect(
      resolveMentionIds({
        text: '@carol 你好',
        mentions: [],
        members: m,
        names: n,
        senderId: 'u_z',
      }),
    ).toEqual(['u_carol']);
  });
});
