import {
  api,
  type ContactView,
  type MemberView,
  MODE_LABELS,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { HandRaisedIcon, SparklesIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { RiLogoutBoxRLine, RiRobot2Line, RiUserUnfollowLine } from '@remixicon/react';
import { useEffect, useState } from 'react';
import { ResizeHandle } from '@/components/layout/resize-handle';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useResizableWidth } from '@/lib/use-resizable-width';
import { cn } from '@/lib/utils';

export function MemberPanel({
  members,
  aiMode,
  onTakeover,
  busy,
  convId,
  isGroup,
  myRole,
  onLeft,
}: {
  members: MemberView[];
  aiMode: string;
  onTakeover: () => void;
  busy: boolean;
  convId: string;
  /** 普通群聊才支持成员管理（direct / avatar_self / 未来的系统会话均隐藏） */
  isGroup: boolean;
  myRole: string;
  onLeft: () => void;
}) {
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const humans = members.filter((m) => m.principalType === 'human');
  const avatars = members.filter((m) => m.principalType === 'avatar');
  const { width, onHandlePointerDown } = useResizableWidth({
    storageKey: 'chappie.layout.memberWidth',
    initial: 300,
    min: 240,
    max: 420,
    invert: true,
  });

  const isOwner = myRole === 'owner';
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const removeMember = async (principalId: string, name: string) => {
    setRemoving(principalId);
    try {
      await api.removeMember(convId, principalId);
      toast.success('已移除成员', name);
      await useChatStore.getState().loadMembers(convId);
    } catch (e) {
      toast.error('移除失败', e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null);
    }
  };

  const leave = async () => {
    try {
      await api.removeMember(convId, myId);
      toast.success('已退出群聊');
      onLeft();
    } catch (e) {
      toast.error('退出失败', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l border-line bg-panel/40"
    >
      <div
        data-tauri-drag-region
        className="flex select-none items-center justify-between px-4 py-3"
      >
        <h3 data-tauri-drag-region className="text-[13px] font-semibold text-ink">
          成员 · {members.length}
        </h3>
        {isGroup && isOwner ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-surface-veil hover:text-ink"
            onClick={() => setAddOpen(true)}
          >
            <UserPlusIcon className="size-3.5" />
            添加
          </button>
        ) : null}
      </div>
      <div className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2">
        {humans.map((m) => (
          <MemberRow
            key={m.principalId}
            member={m}
            isMe={m.principalId === myId}
            canRemove={isGroup && isOwner && m.principalId !== myId}
            removing={removing === m.principalId}
            onRemove={() => void removeMember(m.principalId, m.name)}
          />
        ))}
        {avatars.length > 0 ? (
          <>
            <p className="flex items-center gap-1 px-2 pb-1 pt-2 text-[10px] font-medium uppercase text-muted-foreground">
              <SparklesIcon className="size-3" /> AI 分身
            </p>
            {avatars.map((m) => (
              <MemberRow key={m.principalId} member={m} isMe={m.ownerId === myId} />
            ))}
          </>
        ) : null}
      </div>
      <div className="space-y-2 border-t border-line/60 p-3">
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
        {isGroup && !isOwner ? (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => void leave()}>
            <RiLogoutBoxRLine className="size-3.5" />
            退出群聊
          </Button>
        ) : null}
      </div>

      <AddMembersDialog open={addOpen} onOpenChange={setAddOpen} convId={convId} />

      <ResizeHandle side="left" onPointerDown={onHandlePointerDown} label="调整成员栏宽度" />
    </aside>
  );
}

function MemberRow({
  member,
  isMe,
  canRemove,
  removing,
  onRemove,
}: {
  member: MemberView;
  isMe: boolean;
  canRemove?: boolean;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const isAvatar = member.principalType === 'avatar';
  return (
    <div className="group flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-surface-veil">
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
      {canRemove && onRemove ? (
        <button
          type="button"
          title={removing ? '移除中…' : `移除 ${member.name}`}
          disabled={removing}
          onClick={onRemove}
          className="hidden shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block"
        >
          <RiUserUnfollowLine className="size-3.5" />
        </button>
      ) : isAvatar ? (
        <RiRobot2Line className="size-3 shrink-0 text-agent/80" />
      ) : null}
    </div>
  );
}

function AddMembersDialog({
  open,
  onOpenChange,
  convId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  convId: string;
}) {
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    api
      .listContacts()
      .then((r) => setContacts(r.contacts))
      .catch((e) => toast.error('加载联系人失败', e instanceof Error ? e.message : String(e)));
  }, [open]);

  const existingHumans = new Set(
    (useChatStore.getState().membersByConv[convId] ?? [])
      .filter((m) => m.principalType === 'human')
      .map((m) => m.principalId),
  );
  const candidates = contacts.filter((c) => !existingHumans.has(c.user.id));

  const add = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await api.addMembers(convId, { memberUserIds: selected });
      toast.success('已添加成员');
      onOpenChange(false);
      await useChatStore.getState().loadMembers(convId);
      await useChatStore.getState().loadConversations();
    } catch (e) {
      toast.error('添加成员失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>添加群成员</DialogTitle>
          <DialogDescription>从联系人中选择；对方与 TA 的分身会一同加入。</DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              没有可添加的联系人。先在「新建会话」里按邮箱添加联系人。
            </p>
          ) : (
            candidates.map((c) => {
              const checked = selected.includes(c.user.id);
              return (
                <button
                  type="button"
                  key={c.user.id}
                  onClick={() =>
                    setSelected((s) =>
                      s.includes(c.user.id) ? s.filter((x) => x !== c.user.id) : [...s, c.user.id],
                    )
                  }
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors',
                    checked ? 'bg-accent' : 'hover:bg-muted/70',
                  )}
                >
                  <UserAvatar name={c.user.name} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.user.email}</div>
                  </div>
                  {checked ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      ✓
                    </span>
                  ) : (
                    <span className="size-5 rounded-full border" />
                  )}
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => void add()} disabled={busy || selected.length === 0}>
            添加（{selected.length}）
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
