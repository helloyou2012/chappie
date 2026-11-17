import {
  api,
  type ConversationView,
  type DeviceView,
  formatTime,
  type RealtimeStatus,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import {
  RiAddLine,
  RiComputerLine,
  RiNotificationOffLine,
  RiSearchLine,
  RiSmartphoneLine,
  RiWifiLine,
  RiWifiOffLine,
} from '@remixicon/react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { openCommandPalette } from '@/components/layout/command-palette';
import { NewConversationDialog } from '@/components/layout/new-conversation-dialog';
import { ResizeHandle } from '@/components/layout/resize-handle';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { subscribeRealtimeStatus } from '@/lib/realtime';
import { useResizableWidth } from '@/lib/use-resizable-width';
import { cn } from '@/lib/utils';

function ConnectionDot({ status }: { status: RealtimeStatus }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-tertiary">
      {status === 'open' ? (
        <>
          <RiWifiLine className="size-3 text-success" /> 已连接
        </>
      ) : status === 'connecting' ? (
        <>
          <RiWifiLine className="size-3 animate-pulse text-warning" /> 连接中
        </>
      ) : (
        <>
          <RiWifiOffLine className="size-3 text-destructive" /> 已断开
        </>
      )}
    </span>
  );
}

function ConvItem({ view, myId }: { view: ConversationView; myId: string }) {
  const location = useLocation();
  const active = location.pathname === `/chat/${view.conversation.id}`;
  const isSelf = view.conversation.systemTag === 'avatar_self';
  const isGroup = view.conversation.type === 'group';
  const preview = view.lastMsgPreview ?? '暂无消息';
  const fromMe = view.lastMsgSenderId === myId;
  // 群聊预览带发送者（「陈美丽: 内容」），与微信/飞书一致
  const previewPrefix =
    isGroup && !fromMe && view.lastMsgSenderName
      ? `${view.lastMsgSenderName}：`
      : fromMe
        ? '我：'
        : '';
  const muted = view.myAiMode === 'off';

  return (
    <Link
      to={`/chat/${view.conversation.id}`}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150',
        active ? 'bg-surface-raised shadow-card' : 'hover:bg-surface-veil',
      )}
    >
      <div className="relative shrink-0">
        <UserAvatar
          name={view.displayTitle}
          variant={isSelf ? 'avatar' : isGroup ? 'group' : 'human'}
          className="size-9"
        />
        {isSelf ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border-2 border-panel bg-brand text-[8px] font-medium text-primary-foreground">
            AI
          </span>
        ) : null}
        {view.unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-panel bg-destructive" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-medium text-ink">{view.displayTitle}</span>
            {isSelf ? (
              <Badge variant="ai" className="shrink-0">
                分身
              </Badge>
            ) : isGroup ? (
              <Badge variant="muted" className="shrink-0">
                群聊
              </Badge>
            ) : null}
            {muted ? (
              <RiNotificationOffLine
                className="size-3 shrink-0 text-ink-quaternary"
                aria-label="静默"
              />
            ) : null}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-quaternary">
            {formatTime(view.lastMsgAt)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate text-[12px] text-ink-tertiary">
            {previewPrefix}
            {preview}
          </span>
          {view.unreadCount > 0 ? (
            <Badge className="h-4 min-w-4 justify-center px-1 text-[10px] tracking-normal">
              {view.unreadCount > 99 ? '99+' : view.unreadCount}
            </Badge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/**
 * 会话列表栏：仅承载「消息」标题、新建会话与列表；
 * 导航与账户菜单已移至最左侧的 IconRail。
 */
export function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const loading = useChatStore((s) => s.loadingConversations);
  const user = useAuthStore((s) => s.user);
  const [wsStatus, setWsStatus] = useState<RealtimeStatus>('connecting');
  const { width, onHandlePointerDown } = useResizableWidth({
    storageKey: 'chappie.layout.sidebarWidth.v2',
    initial: 272,
    min: 220,
    max: 400,
  });

  useEffect(() => subscribeRealtimeStatus(setWsStatus), []);

  const myId = user?.id ?? '';

  // 多端在线条（参考微信「Mac已登录」）：展示最近活跃的其他端
  const [otherDevice, setOtherDevice] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const currentPlatform =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'desktop' : 'web';
    api
      .listDevices()
      .then((res) => {
        if (cancelled) return;
        const platformLabel: Record<string, string> = {
          ios: '手机端',
          android: '手机端',
          desktop: '桌面端',
          web: '网页端',
        };
        const other = (res.devices as DeviceView[]).find((d) => d.platform !== currentPlatform);
        setOtherDevice(other ? (platformLabel[other.platform] ?? other.platform) : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-line bg-panel"
    >
      <div
        data-tauri-drag-region
        className="flex select-none items-center justify-between px-3.5 py-3"
      >
        <h1
          data-tauri-drag-region
          className="text-[15px] font-semibold tracking-[-0.01em] text-ink"
        >
          消息
        </h1>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="搜索（⌘K）"
            title="搜索（⌘K）"
            onClick={openCommandPalette}
          >
            <RiSearchLine />
          </Button>
          <NewConversationDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label="新建会话">
                <RiAddLine />
              </Button>
            }
          />
        </div>
      </div>

      {otherDevice ? (
        <div className="mx-2 mb-1 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] text-ink-tertiary">
          {otherDevice === '桌面端' || otherDevice === '网页端' ? (
            <RiComputerLine className="size-3.5" />
          ) : (
            <RiSmartphoneLine className="size-3.5" />
          )}
          <span className="truncate">{otherDevice}已登录</span>
        </div>
      ) : null}

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
        {loading && conversations.length === 0 ? (
          <div className="space-y-1 px-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12px] text-ink-tertiary">
            还没有会话，点右上角 + 开始
          </p>
        ) : (
          conversations.map((v) => <ConvItem key={v.conversation.id} view={v} myId={myId} />)
        )}
      </div>

      <div className="flex items-center px-4 py-2.5">
        <ConnectionDot status={wsStatus} />
      </div>

      <ResizeHandle side="right" onPointerDown={onHandlePointerDown} label="调整会话列表宽度" />
    </aside>
  );
}
