/** 聊天状态归约：消息排序/去重、未读、断洞补拉、pending、服务端帧分发（纯内存）。 */
import { beforeEach, describe, expect, test } from 'bun:test';
import type { Content, ConversationView, MemberView, Message } from '@chappie/contract';
import { useAuthStore } from '../src/store/auth';
import { setPullHandler, useChatStore } from '../src/store/chat';

const ME = 'u_me';
const CONV = 'c_test';

const text = (t: string): Content => ({ type: 'text', schemaVersion: 1, text: t });

function msg(seq: number, opts: Partial<Message> = {}): Message {
  return {
    msgId: `m_${seq}`,
    convId: CONV,
    seq,
    clientMsgId: null,
    senderId: 'u_other',
    senderType: 'human',
    content: text(`消息 ${seq}`),
    createdAt: new Date(Date.now() + seq * 1000).toISOString(),
    recalled: false,
    ...opts,
  } as Message;
}

function convView(id: string, lastSeq = 0): ConversationView {
  return {
    conversation: { id, lastSeq },
    myLastReadSeq: 0,
    unreadCount: 0,
    lastMsgPreview: '',
    lastMsgAt: null,
    lastMsgSenderId: null,
  } as unknown as ConversationView;
}

function seed(messages: Message[] = [], activeConvId: string | null = CONV): void {
  useChatStore.setState({
    conversations: [convView(CONV)],
    messagesByConv: messages.length ? { [CONV]: messages } : {},
    activeConvId,
    pendingByConv: {},
    typingByConv: {},
    onlineByPrincipal: {},
    membersByConv: {},
  });
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: ME } as never });
  useChatStore.getState().reset();
  setPullHandler(null);
  seed();
});

describe('appendMessage', () => {
  test('按 seq 排序并去重', () => {
    seed([msg(2)]);
    const store = useChatStore.getState();
    store.appendMessage(msg(1));
    store.appendMessage(msg(2)); // 重复
    const list = useChatStore.getState().messagesByConv[CONV] ?? [];
    expect(list.map((m) => m.seq)).toEqual([1, 2]);
  });

  test('非当前会话的新消息增加未读；当前会话不增加', () => {
    seed();
    useChatStore.getState().appendMessage(msg(1));
    expect(useChatStore.getState().conversations[0]?.unreadCount).toBe(0); // active

    useChatStore.setState({ activeConvId: null });
    useChatStore.getState().appendMessage(msg(2));
    expect(useChatStore.getState().conversations[0]?.unreadCount).toBe(1);
  });

  test('自己发送的消息不增加未读，并清理同内容的本地 pending', () => {
    seed();
    useChatStore.setState({ activeConvId: null });
    useChatStore.getState().addPending({
      clientMsgId: 'cm_1',
      convId: CONV,
      content: text('我发的'),
      mentions: [],
      replyTo: null,
      createdAt: new Date().toISOString(),
    });
    useChatStore.getState().appendMessage(msg(1, { senderId: ME, content: text('我发的') }));
    const state = useChatStore.getState();
    expect(state.conversations[0]?.unreadCount).toBe(0);
    expect(state.pendingByConv[CONV] ?? []).toHaveLength(0);
  });

  test('seq 断洞触发补拉（不重复请求已有的最后 seq）', () => {
    const calls: [string, number][] = [];
    setPullHandler((convId, fromSeq) => calls.push([convId, fromSeq]));
    seed([msg(1)]);
    useChatStore.getState().appendMessage(msg(3));
    expect(calls).toEqual([[CONV, 1]]);
  });

  test('messages_batch 补拉结果不再触发二次补拉', () => {
    const calls: [string, number][] = [];
    setPullHandler((convId, fromSeq) => calls.push([convId, fromSeq]));
    seed([msg(1)]);
    useChatStore.getState().applyServerFrame({
      type: 'messages_batch',
      convId: CONV,
      messages: [msg(2), msg(3)],
    });
    expect(calls).toEqual([]);
    expect(useChatStore.getState().messagesByConv[CONV]?.map((m) => m.seq)).toEqual([1, 2, 3]);
  });
});

describe('服务端帧', () => {
  test('message_acked 按 clientMsgId 移除 pending', () => {
    seed();
    useChatStore.getState().addPending({
      clientMsgId: 'cm_x',
      convId: CONV,
      content: text('hi'),
      mentions: [],
      replyTo: null,
      createdAt: new Date().toISOString(),
    });
    useChatStore.getState().applyServerFrame({
      type: 'message_acked',
      clientMsgId: 'cm_x',
      msgId: 'm_1',
      seq: 1,
      serverTime: new Date().toISOString(),
    });
    expect(useChatStore.getState().pendingByConv[CONV] ?? []).toHaveLength(0);
  });

  test('message_created 按 clientMsgId 精确移除 pending', () => {
    seed();
    useChatStore.getState().addPending({
      clientMsgId: 'cm_exact',
      convId: CONV,
      content: text('本地草稿'),
      mentions: [],
      replyTo: null,
      createdAt: new Date().toISOString(),
    });
    useChatStore.getState().applyServerFrame({
      type: 'message_created',
      message: msg(1, {
        senderId: ME,
        clientMsgId: 'cm_exact',
        content: text('服务端规范化后的内容'),
      }),
    });
    expect(useChatStore.getState().pendingByConv[CONV] ?? []).toHaveLength(0);
  });

  test('message_recalled 标记撤回并替换内容', () => {
    seed([msg(1)]);
    useChatStore.getState().applyServerFrame({
      type: 'message_recalled',
      convId: CONV,
      msgId: 'm_1',
      actorId: ME,
    });
    const m = useChatStore.getState().messagesByConv[CONV]?.[0];
    expect(m?.recalled).toBe(true);
    expect(m?.content).toEqual({ type: 'text', schemaVersion: 1, text: '消息已撤回' });
  });

  test('message_updated 替换对应消息', () => {
    seed([msg(1)]);
    useChatStore.getState().applyServerFrame({
      type: 'message_updated',
      message: msg(1, { content: text('已编辑') }),
    });
    const content = useChatStore.getState().messagesByConv[CONV]?.[0]?.content as
      | { text: string }
      | undefined;
    expect(content?.text).toBe('已编辑');
  });

  test('typing / presence 更新状态', () => {
    seed();
    useChatStore.getState().applyServerFrame({
      type: 'typing',
      convId: CONV,
      principalId: 'u_other',
      untilTs: Date.now() + 5000,
    });
    useChatStore.getState().applyServerFrame({
      type: 'presence',
      principalId: 'u_other',
      online: true,
    });
    const state = useChatStore.getState();
    expect(state.typingByConv[CONV]?.u_other).toBeGreaterThan(Date.now());
    expect(state.onlineByPrincipal.u_other).toBe(true);
  });

  test('read_sync 提升成员已读位置（取 max）', () => {
    seed();
    useChatStore.setState({
      membersByConv: {
        [CONV]: [{ principalId: 'u_other', name: '对方', lastReadSeq: 3 } as unknown as MemberView],
      },
    });
    useChatStore.getState().applyServerFrame({
      type: 'read_sync',
      convId: CONV,
      principalId: 'u_other',
      lastReadSeq: 5,
    });
    expect(useChatStore.getState().membersByConv[CONV]?.[0]?.lastReadSeq).toBe(5);
  });
});

describe('本地视图操作', () => {
  test('markReadLocal 清零未读并推进已读 seq', () => {
    seed();
    useChatStore.setState({ activeConvId: null });
    useChatStore.getState().appendMessage(msg(1));
    expect(useChatStore.getState().conversations[0]?.unreadCount).toBe(1);
    useChatStore.getState().markReadLocal(CONV, 1);
    const conv = useChatStore.getState().conversations[0];
    expect(conv?.unreadCount).toBe(0);
    expect(conv?.myLastReadSeq).toBe(1);
  });

  test('removeMessage 移除指定消息', () => {
    seed([msg(1), msg(2)]);
    useChatStore.getState().removeMessage(CONV, 'm_1');
    expect(useChatStore.getState().messagesByConv[CONV]?.map((m) => m.msgId)).toEqual(['m_2']);
  });

  test('reset 清空全部状态', () => {
    seed([msg(1)]);
    useChatStore.getState().reset();
    const state = useChatStore.getState();
    expect(state.messagesByConv).toEqual({});
    expect(state.conversations).toEqual([]);
    expect(state.pendingByConv).toEqual({});
    expect(state.activeConvId).toBeNull();
  });
});
