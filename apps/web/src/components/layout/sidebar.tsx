import {
  type ConversationView,
  formatTime,
  type RealtimeStatus,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { RiAddLine, RiWifiLine, RiWifiOffLine } from '@remixicon/react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NewConversationDialog } from '@/components/layout/new-conversation-dialog';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { subscribeRealtimeStatus } from '@/lib/realtime';
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

  return (
    <Link
      to={`/chat/${view.conversation.id}`}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors duration-150',
        active ? 'bg-surface-selected' : 'hover:bg-surface-raised',
      )}
    >
      <div className="relative">
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
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{view.displayTitle}</span>
          <span className="shrink-0 text-[11px] text-ink-quaternary">
            {formatTime(view.lastMsgAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[12px] text-ink-tertiary">
            {fromMe ? '我：' : ''}
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

  useEffect(() => subscribeRealtimeStatus(setWsStatus), []);

  const myId = user?.id ?? '';

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-line bg-canvas/60 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">消息</h1>
        <NewConversationDialog
          trigger={
            <Button size="icon-sm" variant="ghost" aria-label="新建会话">
              <RiAddLine />
            </Button>
          }
        />
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-2">
        {loading && conversations.length === 0 ? (
          <div className="space-y-1 px-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2.5 px-2 py-2">
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

      <div className="flex items-center px-4 py-2">
        <ConnectionDot status={wsStatus} />
      </div>
    </aside>
  );
}
