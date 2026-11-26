import { contentText } from '@chappie/contract';
import {
  api,
  formatTime,
  type Message,
  type PendingMessage,
  resolveAttachmentUrl,
  STRATEGY_LABELS,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { ChatBubbleLeftRightIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { RiAttachment2, RiFileTextLine, RiInformationLine, RiLoader4Line } from '@remixicon/react';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatInput, type ChatInputHandle } from '@/components/chat/chat-input';
import { MemberPanel } from '@/components/chat/member-panel';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ModeSwitch } from '@/components/chat/mode-switch';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getRealtimeClient } from '@/lib/realtime';
import { cn } from '@/lib/utils';

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
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);
  const messagesByConv = useChatStore((s) => s.messagesByConv);
  const hasMoreBeforeByConv = useChatStore((s) => s.hasMoreBeforeByConv);
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
  const chatInputRef = useRef<ChatInputHandle>(null);
  const dragDepthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const hasFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    if (dragDepthRef.current === 0) return;
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    dragDepthRef.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    e.preventDefault();
    chatInputRef.current?.addFiles(files);
  };
  const atBottomRef = useRef(true);
  const lastScrollKeyRef = useRef<{
    convId?: string;
    lastMsgId: string | null;
    lastPendingId: string | null;
    sig: string;
  }>({ lastMsgId: null, lastPendingId: null, sig: '' });
  const now = useNow(1000);

  const view = conversations.find((c) => c.conversation.id === convId);
  const messages = convId ? (messagesByConv[convId] ?? []) : [];
  const hasMoreBefore = convId ? hasMoreBeforeByConv[convId] : undefined;
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
  const lastPendingId =
    pending.length > 0 ? (pending[pending.length - 1]?.clientMsgId ?? null) : null;
  // 流式更新不会改变 msgId：用正文/思考/工具活动的变化签名触发跟随滚动
  const lastMsgSig = lastMsg
    ? [
        lastMsg.content.type === 'text' ? lastMsg.content.text.length : 0,
        lastMsg.aiMeta?.thinking?.length ?? 0,
        (lastMsg.aiMeta?.activity ?? []).map((a) => `${a.status}:${a.content.length}`).join(','),
        lastMsg.aiMeta?.streaming ? 1 : 0,
      ].join('|')
    : '';

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastScrollKeyRef.current;
    lastScrollKeyRef.current = { convId, lastMsgId, lastPendingId, sig: lastMsgSig };

    if (prev.convId !== convId) {
      atBottomRef.current = true;
      el.scrollTo({ top: el.scrollHeight });
      return;
    }
    const messageChanged = prev.lastMsgId !== lastMsgId;
    const pendingChanged = prev.lastPendingId !== lastPendingId;
    const contentChanged = prev.sig !== lastMsgSig;
    // 最后一条没变（如加载更早消息只是前插，且流式内容无变化）时不滚动
    if (!messageChanged && !pendingChanged && !contentChanged) return;
    const own = pendingChanged || lastMsgSenderId === myId;
    if (own || atBottomRef.current) {
      atBottomRef.current = true;
      if (contentChanged && !messageChanged && !pendingChanged) {
        // 流式增量/定稿：即时贴底，避免 smooth 滚动排队
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [convId, lastMsgId, lastMsgSenderId, lastPendingId, myId, lastMsgSig]);

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
  const activeTypers = Object.entries(typingByConv[convId] ?? {}).filter(
    ([pid, until]) => pid !== myId && until > now,
  );
  const typingMembers = activeTypers.map(
    ([pid]) => members.find((m) => m.principalId === pid)?.name ?? '成员',
  );
  const avatarTyping = activeTypers.some(
    ([pid]) => members.find((m) => m.principalId === pid)?.principalType === 'avatar',
  );

  const loadMore = async () => {
    if (hasMoreBefore === false) return;
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

  const peerReception = view.peerReception;
  const subtitle = isSelfConv
    ? '这是你和分身的控制通道：直接下达指令即可'
    : isGroup
      ? `${members.filter((m) => m.principalType === 'human').length} 位成员 · ${
          members.filter((m) => m.principalType === 'avatar').length
        } 个分身`
      : peerReception?.state === 'avatar'
        ? `对方由 AI 分身接待 · ${
            STRATEGY_LABELS[peerReception.strategy] ?? peerReception.strategy
          }`
        : '对方当前为真人接待';

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 拖拽上传是鼠标增强，键盘/触摸可用底部附件按钮 */}
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
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
            {isSelfConv ? (
              <Badge variant="ai" className="pointer-events-none">
                控制通道
              </Badge>
            ) : (
              <ModeSwitch convId={view.conversation.id} reception={view.myReception} />
            )}
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
          className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-3"
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-[12px] text-ink-tertiary">
              <RiInformationLine className="size-5" />
              还没有消息，打个招呼吧
            </div>
          ) : hasMoreBefore !== false ? (
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
          ) : null}

          {messages.map((m) => (
            <MessageBubble
              key={m.msgId}
              message={m}
              members={members}
              onReply={(msgId, preview) => setReplyTo({ msgId, preview })}
            />
          ))}

          {pending.map((p) => (
            <PendingBubble key={p.clientMsgId} pending={p} />
          ))}

          {/* 固定高度占位：loading 消失时高度不变，避免贴底视图向上弹一下 */}
          <div
            className={cn(
              'flex h-7 items-center gap-2 px-4 text-[11px] text-muted-foreground transition-opacity duration-150',
              typingMembers.length > 0 ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            aria-hidden={typingMembers.length === 0}
          >
            <span className="ml-10 flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-1">
              <span className="typing-dot size-1 rounded-full bg-current" />
              <span className="typing-dot size-1 rounded-full bg-current" />
              <span className="typing-dot size-1 rounded-full bg-current" />
            </span>
            <span className="truncate">
              {typingMembers.length > 0
                ? avatarTyping
                  ? '分身正在处理…'
                  : `${typingMembers.join('、')} 正在输入…`
                : ' '}
            </span>
          </div>
        </div>

        <ChatInput
          ref={chatInputRef}
          convId={convId}
          members={members}
          isGroup={view?.conversation.type === 'group'}
          avatarTyping={avatarTyping}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />

        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-brand/5 p-6">
            <div className="flex items-center gap-2 rounded-xl border border-brand/30 bg-view px-4 py-2.5 text-sm font-medium text-ink shadow-pop">
              <RiAttachment2 className="size-4 text-brand" />
              松开以添加附件
            </div>
          </div>
        ) : null}
      </div>

      <MemberPanel
        members={members}
        aiMode={view.myAiMode}
        reception={view.myReception}
        onTakeover={() => void takeover()}
        busy={takeoverBusy}
        convId={convId}
        isGroup={isGroup && !isSelfConv}
        isSelfConv={isSelfConv}
        myRole={view.myRole}
        onLeft={() => {
          void useChatStore.getState().loadConversations();
          navigate('/chat');
        }}
      />
    </div>
  );
}

function PendingBubble({ pending }: { pending: PendingMessage }) {
  const content = pending.content;
  const uploading = pending.status === 'uploading';
  return (
    <div className="flex flex-row-reverse gap-2 px-4 py-1.5">
      <div className="w-8 shrink-0" />
      <div className="flex max-w-[72%] flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          <span>我</span>
          <span>{formatTime(pending.createdAt)}</span>
          {pending.status === 'failed' ? (
            <span className="text-destructive">上传失败</span>
          ) : (
            <>
              <RiLoader4Line className="size-2.5 animate-spin" />
              <span>{uploading ? '上传中' : '发送中'}</span>
            </>
          )}
        </div>
        {content.type === 'image' ? (
          <div className="relative overflow-hidden rounded-xl bg-muted">
            {content.url ? (
              <img
                src={resolveAttachmentUrl(content.url)}
                alt={content.name ?? '图片'}
                className={cn('max-h-60 max-w-[260px] object-contain', uploading && 'opacity-70')}
              />
            ) : (
              <div className="flex h-36 w-52 items-center justify-center">
                <RiLoader4Line className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {uploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                <RiLoader4Line className="size-5 animate-spin text-white" />
              </div>
            ) : null}
          </div>
        ) : content.type === 'file' ? (
          <div className="flex w-64 items-center gap-2 rounded-xl bg-primary/70 px-3 py-2 text-primary-foreground">
            <RiFileTextLine className="size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{content.name}</div>
              {typeof content.size === 'number' ? (
                <div className="text-[10px] opacity-80">{formatBytes(content.size)}</div>
              ) : null}
            </div>
            {uploading ? <RiLoader4Line className="size-4 shrink-0 animate-spin" /> : null}
          </div>
        ) : (
          <div className="rounded-2xl bg-primary/70 px-3.5 py-2 text-sm text-primary-foreground break-words whitespace-pre-wrap">
            {contentText(content)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 供外部类型推断使用 */
export type { Message };
