import { contentText } from '@chappie/contract';
import { api, formatTime, type Message, useAuthStore, useChatStore } from '@chappie/shared';
import { ChatBubbleLeftRightIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { RiInformationLine, RiLoader4Line } from '@remixicon/react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChatInput } from '@/components/chat/chat-input';
import { MemberPanel } from '@/components/chat/member-panel';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ModeSwitch } from '@/components/chat/mode-switch';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getRealtimeClient } from '@/lib/realtime';

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ChatPage() {
  const { convId } = useParams<{ convId?: string }>();
  const conversations = useChatStore((s) => s.conversations);
  const messagesByConv = useChatStore((s) => s.messagesByConv);
  const pendingByConv = useChatStore((s) => s.pendingByConv);
  const membersByConv = useChatStore((s) => s.membersByConv);
  const typingByConv = useChatStore((s) => s.typingByConv);
  const setActiveConv = useChatStore((s) => s.setActiveConv);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadMembers = useChatStore((s) => s.loadMembers);
  const myId = useAuthStore((s) => s.user?.id ?? '');

  const [replyTo, setReplyTo] = useState<{ msgId: string; preview: string } | null>(null);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastScrollKeyRef = useRef<{
    convId?: string;
    lastMsgId: string | null;
    lastPendingId: string | null;
  }>({ lastMsgId: null, lastPendingId: null });
  const now = useNow(1000);

  const view = conversations.find((c) => c.conversation.id === convId);
  const messages = convId ? (messagesByConv[convId] ?? []) : [];
  const pending = convId ? (pendingByConv[convId] ?? []) : [];
  const members = convId ? (membersByConv[convId] ?? []) : [];

  useEffect(() => {
    if (!convId) {
      setActiveConv(null);
      return;
    }
    setActiveConv(convId);
    setReplyTo(null);
    if (!useChatStore.getState().loadedConvIds.has(convId)) {
      void loadMessages(convId).catch((e) =>
        toast.error('加载消息失败', e instanceof Error ? e.message : String(e)),
      );
    }
    void loadMembers(convId).catch(() => undefined);
    return () => setActiveConv(null);
  }, [convId, setActiveConv, loadMessages, loadMembers]);

  // 自动已读
  useEffect(() => {
    if (!convId) return;
    const list = useChatStore.getState().messagesByConv[convId] ?? [];
    const last = list[list.length - 1];
    if (!last || last.seq <= 0) return;
    const state = useChatStore.getState();
    const conv = state.conversations.find((c) => c.conversation.id === convId);
    if (last.seq > (conv?.myLastReadSeq ?? 0)) {
      getRealtimeClient()?.markRead(convId, last.seq);
      state.markReadLocal(convId, last.seq);
    }
  }, [convId]);

  // 滚动到底部：切换会话直接跳底；自己发消息（含回复）总是跟随；
  // 收到新消息时仅当原本停留在底部附近才跟随，避免打断向上翻阅历史
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastMsgId = lastMsg?.msgId ?? null;
  const lastMsgSenderId = lastMsg?.senderId;
  const lastPendingId = pending.length > 0 ? pending[pending.length - 1]?.clientMsgId ?? null : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastScrollKeyRef.current;
    lastScrollKeyRef.current = { convId, lastMsgId, lastPendingId };

    if (prev.convId !== convId) {
      atBottomRef.current = true;
      el.scrollTo({ top: el.scrollHeight });
      return;
    }
    // 最后一条没变（如加载更早消息只是前插）时不滚动
    if (prev.lastMsgId === lastMsgId && prev.lastPendingId === lastPendingId) return;
    const own = lastPendingId !== prev.lastPendingId || lastMsgSenderId === myId;
    if (own || atBottomRef.current) {
      atBottomRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [convId, lastMsgId, lastMsgSenderId, lastPendingId, myId]);

  if (!convId || !view) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <div className="flex size-16 items-center justify-center rounded-xl bg-surface-veil">
          <ChatBubbleLeftRightIcon className="size-8" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">选择一个会话开始</p>
          <p className="mt-1 text-xs">你的 AI 分身会在被 @ 或自动档时替你回复</p>
        </div>
      </div>
    );
  }

  const isSelfConv = view.conversation.systemTag === 'avatar_self';
  const isGroup = view.conversation.type === 'group';
  const typingMembers = Object.entries(typingByConv[convId] ?? {})
    .filter(([pid, until]) => pid !== myId && until > now)
    .map(([pid]) => members.find((m) => m.principalId === pid)?.name ?? '成员');

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await loadMessages(convId, { before: true });
    } catch (e) {
      toast.error('加载失败', String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const takeover = async () => {
    setTakeoverBusy(true);
    try {
      await api.takeover(convId);
      toast.success('已接管', '分身已暂停并冷却 15 分钟');
    } catch (e) {
      toast.error('接管失败', e instanceof Error ? e.message : String(e));
    } finally {
      setTakeoverBusy(false);
    }
  };

  const subtitle = isSelfConv
    ? '这是你和分身的控制通道：直接下达指令即可'
    : `${members.filter((m) => m.principalType === 'human').length} 位成员 · ${members.filter((m) => m.principalType === 'avatar').length} 个分身`;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header
          data-tauri-drag-region
          className="flex h-14 shrink-0 select-none items-center justify-between gap-3 px-3"
        >
          <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
            <UserAvatar
              name={view.displayTitle}
              variant={isSelfConv ? 'avatar' : isGroup ? 'group' : 'human'}
              className="pointer-events-none size-8"
            />
            <div data-tauri-drag-region className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2
                  data-tauri-drag-region
                  className="truncate text-[14px] font-semibold tracking-[-0.012em]"
                >
                  {view.displayTitle}
                </h2>
                {isSelfConv ? (
                  <Badge variant="ai" className="pointer-events-none">
                    <SparklesIcon className="size-2.5" /> 分身
                  </Badge>
                ) : isGroup ? (
                  <Badge variant="muted" className="pointer-events-none">
                    群聊
                  </Badge>
                ) : null}
              </div>
              <p data-tauri-drag-region className="truncate text-[11px] text-ink-tertiary">
                {subtitle}
              </p>
            </div>
          </div>
          <div data-tauri-drag-region className="flex shrink-0 items-center gap-2">
            <ModeSwitch
              convId={view.conversation.id}
              mode={view.myAiMode}
              until={view.myAiModeUntil}
            />
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-3"
        >
          {messages.length > 0 ? (
            <div className="mb-2 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? <RiLoader4Line className="size-3 animate-spin" /> : null}
                加载更早消息
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-[12px] text-ink-tertiary">
              <RiInformationLine className="size-5" />
              还没有消息，打个招呼吧
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble
              key={m.msgId}
              message={m}
              members={members}
              onReply={(msgId, preview) => setReplyTo({ msgId, preview })}
            />
          ))}

          {pending.map((p) => (
            <PendingBubble
              key={p.clientMsgId}
              text={contentText(p.content)}
              createdAt={p.createdAt}
            />
          ))}

          {typingMembers.length > 0 ? (
            <div className="flex items-center gap-2 px-4 py-1 text-[11px] text-muted-foreground">
              <span className="ml-10 flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                <span className="typing-dot size-1 rounded-full bg-current" />
                <span className="typing-dot size-1 rounded-full bg-current" />
                <span className="typing-dot size-1 rounded-full bg-current" />
              </span>
              {typingMembers.join('、')} 正在输入…
            </div>
          ) : null}
        </div>

        <ChatInput
          convId={convId}
          members={members}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      </div>

      <MemberPanel
        members={members}
        aiMode={view.myAiMode}
        onTakeover={() => void takeover()}
        busy={takeoverBusy}
      />
    </div>
  );
}

function PendingBubble({ text, createdAt }: { text: string; createdAt: string }) {
  return (
    <div className="flex flex-row-reverse gap-2 px-4 py-1.5 opacity-60">
      <div className="w-8 shrink-0" />
      <div className="flex max-w-[72%] flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          <span>我</span>
          <span>{formatTime(createdAt)}</span>
          <RiLoader4Line className="size-2.5 animate-spin" />
        </div>
        <div className="rounded-2xl bg-primary/70 px-3.5 py-2 text-sm text-primary-foreground break-words whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}

/** 供外部类型推断使用 */
export type { Message };
