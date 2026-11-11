import { type MemberView, MODE_LABELS, useAuthStore } from '@chappie/shared';
import { HandRaisedIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { RiRobot2Line } from '@remixicon/react';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function MemberPanel({
  members,
  aiMode,
  onTakeover,
  busy,
}: {
  members: MemberView[];
  aiMode: string;
  onTakeover: () => void;
  busy: boolean;
}) {
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const humans = members.filter((m) => m.principalType === 'human');
  const avatars = members.filter((m) => m.principalType === 'avatar');

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-line bg-panel/40 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
          成员 · {members.length}
        </h3>
      </div>
      <div className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2">
        {humans.map((m) => (
          <MemberRow key={m.principalId} member={m} isMe={m.principalId === myId} />
        ))}
        {avatars.length > 0 ? (
          <>
            <p className="flex items-center gap-1 px-2 pb-1 text-[10px] font-medium uppercase text-muted-foreground">
              <SparklesIcon className="size-3" /> AI 分身
            </p>
            {avatars.map((m) => (
              <MemberRow key={m.principalId} member={m} isMe={m.ownerId === myId} />
            ))}
          </>
        ) : null}
      </div>
      <div className="space-y-2 border-t p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">我的分身档位</span>
          <Badge variant="ai">{MODE_LABELS[aiMode] ?? aiMode}</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={onTakeover}
          title="立即停止分身工作并交出上下文（冷却 15 分钟）"
        >
          <HandRaisedIcon className="size-3.5" />
          接管对话
        </Button>
      </div>
    </aside>
  );
}

function MemberRow({ member, isMe }: { member: MemberView; isMe: boolean }) {
  const isAvatar = member.principalType === 'avatar';
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
      <div className="relative">
        <UserAvatar name={member.name} variant={isAvatar ? 'avatar' : 'human'} className="size-7" />
        {member.principalType === 'human' ? (
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-panel',
              member.online ? 'bg-success' : 'bg-muted-foreground/40',
            )}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-ink">
          {member.name}
          {isMe ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              {isAvatar ? '（我的分身）' : '（我）'}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[10px] text-ink-tertiary">
          {isAvatar
            ? `AI · ${MODE_LABELS[member.aiMode] ?? member.aiMode}`
            : member.role === 'owner'
              ? '群主'
              : '成员'}
        </div>
      </div>
      {isAvatar ? <RiRobot2Line className="size-3 shrink-0 text-agent/80" /> : null}
    </div>
  );
}
