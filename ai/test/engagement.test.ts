/** 会话延续（P1）：回复链 + 同发送者窗口。 */
import { describe, expect, test } from 'bun:test';
import { deriveEngagement, type EngagementMessage } from '../src/engagement';
import type { MemberSnapshot } from '../src/router';

const MEMBERS: MemberSnapshot[] = [
  { principalId: 'u_alice', principalType: 'human', ownerId: null },
  { principalId: 'u_bob', principalType: 'human', ownerId: null },
  { principalId: 'a_alice', principalType: 'avatar', ownerId: 'u_alice' },
  { principalId: 'a_bob', principalType: 'avatar', ownerId: 'u_bob' },
];

const NOW = new Date('2026-11-17T12:00:00Z');
function msg(over: Partial<EngagementMessage>): EngagementMessage {
  return {
    msgId: 'm',
    senderId: 'u_alice',
    senderType: 'human',
    mentions: [],
    replyTo: null,
    createdAt: new Date(NOW.getTime() - 60_000),
    ...over,
  };
}

function derive(
  over: Partial<EngagementMessage>,
  recent: EngagementMessage[],
  opts?: { convType?: string; replyToAvatar?: string },
) {
  const message = msg(over);
  return deriveEngagement({
    message,
    recent,
    replyTargets: opts?.replyToAvatar
      ? new Map([[opts.replyToAvatar, { senderId: 'a_alice', senderType: 'avatar' }]])
      : new Map(),
    members: MEMBERS,
    convType: opts?.convType ?? 'group',
    now: NOW,
  });
}

describe('回复链', () => {
  test('回复分身的消息 → replyToAvatarId', () => {
    const result = derive({ senderId: 'u_alice', replyTo: 'm_avatar' }, [], {
      replyToAvatar: 'm_avatar',
    });
    expect(result.replyToAvatarId).toBe('a_alice');
  });

  test('私聊里回复自己的分身不触发', () => {
    const result = derive({ senderId: 'u_alice', replyTo: 'm_avatar' }, [], {
      convType: 'direct',
      replyToAvatar: 'm_avatar',
    });
    expect(result.replyToAvatarId).toBeNull();
  });
});

describe('会话窗口', () => {
  const anchor = msg({
    msgId: 'm_anchor',
    senderId: 'u_alice',
    mentions: ['a_alice'],
    createdAt: new Date(NOW.getTime() - 5 * 60_000),
  });
  const avatarReply = msg({
    msgId: 'm_reply',
    senderId: 'a_alice',
    senderType: 'avatar',
    createdAt: new Date(NOW.getTime() - 4 * 60_000),
  });

  test('被 @ 后同一发送者的后续消息 → 延续候选', () => {
    const result = derive({ senderId: 'u_alice', text: '那明天晚上8点出来聊下' }, [
      anchor,
      avatarReply,
    ]);
    expect(result.continuationAvatarIds).toEqual(['a_alice']);
  });

  test('其他真人插话 → 会话结束', () => {
    const interject = msg({
      msgId: 'm_bob',
      senderId: 'u_bob',
      createdAt: new Date(NOW.getTime() - 2 * 60_000),
    });
    const result = derive({ senderId: 'u_alice', text: '那明天晚上8点出来聊下' }, [
      anchor,
      avatarReply,
      interject,
    ]);
    expect(result.continuationAvatarIds).toEqual([]);
  });

  test('超出 10 分钟窗口 → 不延续', () => {
    const oldAnchor = msg({
      msgId: 'm_old',
      senderId: 'u_alice',
      mentions: ['a_alice'],
      createdAt: new Date(NOW.getTime() - 11 * 60_000),
    });
    const result = derive({ senderId: 'u_alice', text: '那明天晚上8点出来聊下' }, [oldAnchor]);
    expect(result.continuationAvatarIds).toEqual([]);
  });

  test('当前消息 @ 了别人 → 显式提及优先，不延续', () => {
    const result = derive({ senderId: 'u_alice', mentions: ['a_bob'], text: '你觉得呢' }, [
      anchor,
      avatarReply,
    ]);
    expect(result.continuationAvatarIds).toEqual([]);
  });

  test('纯寒暄不延续', () => {
    const result = derive({ senderId: 'u_alice', text: '好的' }, [anchor, avatarReply]);
    expect(result.continuationAvatarIds).toEqual([]);
  });

  test('回复轮次达到 5 次后收尾', () => {
    const replies = Array.from({ length: 5 }, (_, i) =>
      msg({
        msgId: `r${i}`,
        senderId: 'a_alice',
        senderType: 'avatar',
        createdAt: new Date(NOW.getTime() - (4 * 60_000 - i * 10_000)),
      }),
    );
    const result = derive({ senderId: 'u_alice', text: '继续' }, [anchor, ...replies]);
    expect(result.continuationAvatarIds).toEqual([]);
  });

  test('私聊中自己的分身不参与延续', () => {
    const result = derive({ senderId: 'u_alice', text: '那明天见' }, [anchor, avatarReply], {
      convType: 'direct',
    });
    expect(result.continuationAvatarIds).toEqual([]);
  });
});
