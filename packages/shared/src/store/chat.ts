/**
 * 聊天状态：会话列表、消息（按会话分组）、成员、typing、在线状态、乐观消息。
 * ServerFrame 统一在此分发；seq 断洞自动触发补拉（caller 注入 pullHandler）。
 */

import type {
  AvatarMode,
  Content,
  ConversationView,
  MemberView,
  Message,
  ServerFrame,
} from '@chappie/contract';
import { contentText } from '@chappie/contract';
import { create } from 'zustand';
import { api } from '../api';
import { useAuthStore } from './auth';

export interface PendingMessage {
  clientMsgId: string;
  convId: string;
  content: Content;
  mentions: string[];
  replyTo: string | null;
  createdAt: string;
}

let pullHandler: ((convId: string, fromSeq: number) => void) | null = null;
export function setPullHandler(fn: ((convId: string, fromSeq: number) => void) | null): void {
  pullHandler = fn;
}

export function previewOf(msg: Message): string {
  if (msg.recalled) return '消息已撤回';
  return contentText(msg.content);
}

export function displaySenderName(
  msg: Message,
  members: MemberView[] | undefined,
  myId: string,
): string {
  if (msg.senderId === myId) return '我';
  const m = members?.find((x) => x.principalId === msg.senderId);
  return m?.name ?? '成员';
}

interface ChatState {
  conversations: ConversationView[];
  messagesByConv: Record<string, Message[]>;
  membersByConv: Record<string, MemberView[]>;
  pendingByConv: Record<string, PendingMessage[]>;
  typingByConv: Record<string, Record<string, number>>;
  onlineByPrincipal: Record<string, boolean>;
  activeConvId: string | null;
  loadedConvIds: Set<string>;
  loadingConversations: boolean;

  loadConversations: () => Promise<void>;
  loadMessages: (convId: string, opts?: { before?: boolean; limit?: number }) => Promise<void>;
  loadMembers: (convId: string) => Promise<void>;
  setActiveConv: (convId: string | null) => void;
  appendMessage: (msg: Message, fromPull?: boolean) => void;
  applyServerFrame: (frame: ServerFrame) => void;
  addPending: (p: PendingMessage) => void;
  removePending: (convId: string, clientMsgId: string) => void;
  clearPendingByConv: (convId: string) => void;
  removeMessage: (convId: string, msgId: string) => void;
  updateMessage: (msg: Message) => void;
  updateConversationMode: (convId: string, aiMode: AvatarMode, tempHours?: number) => Promise<void>;
  markReadLocal: (convId: string, seq: number) => void;
  reset: () => void;
}

const RECONNECT_HISTORY_GUARD = 200;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  messagesByConv: {},
  membersByConv: {},
  pendingByConv: {},
  typingByConv: {},
  onlineByPrincipal: {},
  activeConvId: null,
  loadedConvIds: new Set(),
  loadingConversations: false,

  loadConversations: async () => {
    set({ loadingConversations: true });
    try {
      const res = await api.listConversations();
      set({ conversations: res.views });
    } finally {
      set({ loadingConversations: false });
    }
  },

  loadMessages: async (convId, opts) => {
    const state = get();
    const existing = state.messagesByConv[convId] ?? [];
    const beforeSeq = opts?.before && existing.length > 0 ? existing[0].seq : undefined;
    const res = await api.listMessages(convId, {
      beforeSeq,
      limit: opts?.limit ?? 50,
    });
    set((s) => {
      const prev = s.messagesByConv[convId] ?? [];
      const map = new Map<string, Message>();
      for (const m of [...res.messages, ...prev]) map.set(m.msgId, m);
      const merged = [...map.values()].sort((a, b) => a.seq - b.seq);
      return {
        messagesByConv: { ...s.messagesByConv, [convId]: merged },
        loadedConvIds: new Set([...s.loadedConvIds, convId]),
      };
    });
  },

  loadMembers: async (convId) => {
    const res = await api.listMembers(convId);
    set((s) => ({
      membersByConv: { ...s.membersByConv, [convId]: res.members },
      onlineByPrincipal: {
        ...s.onlineByPrincipal,
        ...Object.fromEntries(res.members.map((m) => [m.principalId, m.online])),
      },
    }));
  },

  setActiveConv: (convId) => {
    set({ activeConvId: convId });
    if (convId) {
      const conv = get().conversations.find((c) => c.conversation.id === convId);
      if (conv && conv.unreadCount > 0) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.conversation.id === convId ? { ...c, unreadCount: 0 } : c,
          ),
        }));
      }
    }
  },

  appendMessage: (msg, fromPull = false) => {
    const myId = useAuthStore.getState().user?.id ?? '';
    const state = get();
    const list = state.messagesByConv[msg.convId] ?? [];

    // 去重
    if (list.some((m) => m.msgId === msg.msgId)) return;

    const lastSeq = list.length > 0 ? list[list.length - 1].seq : 0;
    const hasGap = !fromPull && lastSeq > 0 && msg.seq > lastSeq + 1;
    const isActive = state.activeConvId === msg.convId;
    const fromMe = msg.senderId === myId;

    set((s) => {
      const prev = s.messagesByConv[msg.convId] ?? [];
      const next = [...prev, msg].sort((a, b) => a.seq - b.seq);

      const convs = [...s.conversations];
      const idx = convs.findIndex((c) => c.conversation.id === msg.convId);
      if (idx >= 0) {
        const current = convs[idx];
        const updated: ConversationView = {
          ...current,
          conversation: {
            ...current.conversation,
            lastSeq: Math.max(current.conversation.lastSeq, msg.seq),
          },
          lastMsgPreview: previewOf(msg),
          lastMsgAt: msg.createdAt,
          lastMsgSenderId: msg.senderId,
          myLastReadSeq: isActive
            ? Math.max(current.myLastReadSeq, msg.seq)
            : current.myLastReadSeq,
          unreadCount: fromMe || isActive ? current.unreadCount : current.unreadCount + 1,
        };
        convs.splice(idx, 1);
        convs.unshift(updated);
      }

      // 当前会话自动清理本地 pending（发送者是自己）：
      // 同时按 clientMsgId 精确对账与内容兜底，覆盖旧服务端未回传 clientMsgId 的情况
      const pending = fromMe
        ? (s.pendingByConv[msg.convId] ?? []).filter(
            (p) =>
              p.clientMsgId !== msg.clientMsgId &&
              contentText(p.content) !== contentText(msg.content),
          )
        : s.pendingByConv[msg.convId];

      return {
        messagesByConv: { ...s.messagesByConv, [msg.convId]: next },
        conversations: convs,
        pendingByConv: { ...s.pendingByConv, [msg.convId]: pending ?? [] },
      };
    });

    // seq 断洞 → 补拉（设计方案 §25.2 客户端按 seq 补洞）
    if (hasGap && pullHandler) {
      pullHandler(msg.convId, lastSeq);
    }
  },

  applyServerFrame: (frame) => {
    switch (frame.type) {
      case 'message_created':
        get().appendMessage(frame.message);
        break;
      case 'message_acked': {
        const convId = get().activeConvId;
        set((s) => {
          const next: Record<string, PendingMessage[]> = {};
          for (const [cid, list] of Object.entries(s.pendingByConv)) {
            next[cid] = list.filter((p) => p.clientMsgId !== frame.clientMsgId);
          }
          return { pendingByConv: next };
        });
        // 若 ack 对应的消息广播没到达（极端情况），主动补拉
        void convId;
        break;
      }
      case 'message_recalled':
        set((s) => {
          const list = s.messagesByConv[frame.convId];
          if (!list) return s;
          const updated = list.map((m) =>
            m.msgId === frame.msgId
              ? {
                  ...m,
                  recalled: true,
                  content: { type: 'text' as const, schemaVersion: 1, text: '消息已撤回' },
                }
              : m,
          );
          return { messagesByConv: { ...s.messagesByConv, [frame.convId]: updated } };
        });
        break;
      case 'message_updated':
        get().updateMessage(frame.message);
        break;
      case 'messages_batch':
        for (const m of frame.messages) get().appendMessage(m, true);
        break;
      case 'typing':
        set((s) => ({
          typingByConv: {
            ...s.typingByConv,
            [frame.convId]: {
              ...(s.typingByConv[frame.convId] ?? {}),
              [frame.principalId]: frame.untilTs,
            },
          },
        }));
        break;
      case 'presence':
        set((s) => ({
          onlineByPrincipal: { ...s.onlineByPrincipal, [frame.principalId]: frame.online },
        }));
        break;
      case 'read_sync':
        set((s) => {
          const members = s.membersByConv[frame.convId];
          if (!members) return s;
          return {
            membersByConv: {
              ...s.membersByConv,
              [frame.convId]: members.map((m) =>
                m.principalId === frame.principalId
                  ? { ...m, lastReadSeq: Math.max(m.lastReadSeq, frame.lastReadSeq) }
                  : m,
              ),
            },
          };
        });
        break;
      case 'conversations_changed':
        void get()
          .loadConversations()
          .catch(() => undefined);
        break;
      default:
        break;
    }
  },

  addPending: (p) =>
    set((s) => ({
      pendingByConv: {
        ...s.pendingByConv,
        [p.convId]: [...(s.pendingByConv[p.convId] ?? []), p].slice(-RECONNECT_HISTORY_GUARD),
      },
    })),

  removePending: (convId, clientMsgId) =>
    set((s) => ({
      pendingByConv: {
        ...s.pendingByConv,
        [convId]: (s.pendingByConv[convId] ?? []).filter((p) => p.clientMsgId !== clientMsgId),
      },
    })),

  clearPendingByConv: (convId) =>
    set((s) => ({ pendingByConv: { ...s.pendingByConv, [convId]: [] } })),

  removeMessage: (convId, msgId) =>
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [convId]: (s.messagesByConv[convId] ?? []).filter((m) => m.msgId !== msgId),
      },
    })),

  updateMessage: (msg) =>
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [msg.convId]: (s.messagesByConv[msg.convId] ?? []).map((m) =>
          m.msgId === msg.msgId ? msg : m,
        ),
      },
    })),

  updateConversationMode: async (convId, aiMode, tempHours) => {
    await api.updateSettings(convId, { aiMode, tempHours });
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.conversation.id === convId
          ? {
              ...c,
              myAiMode: aiMode,
              myAiModeUntil: tempHours
                ? new Date(Date.now() + tempHours * 3600_000).toISOString()
                : null,
            }
          : c,
      ),
    }));
  },

  markReadLocal: (convId, seq) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.conversation.id === convId
          ? { ...c, myLastReadSeq: Math.max(c.myLastReadSeq, seq), unreadCount: 0 }
          : c,
      ),
    }));
  },

  reset: () =>
    set({
      conversations: [],
      messagesByConv: {},
      membersByConv: {},
      pendingByConv: {},
      typingByConv: {},
      onlineByPrincipal: {},
      activeConvId: null,
      loadedConvIds: new Set(),
    }),
}));
