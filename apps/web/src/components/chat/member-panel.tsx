import {
  api,
  type ContactView,
  type MemberView,
  MODE_LABELS,
  RECEPTION_LABELS,
  type ReceptionView,
  STRATEGY_LABELS,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { HandRaisedIcon, SparklesIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import {
  RiDeleteBin6Line,
  RiLogoutBoxRLine,
  RiMoreFill,
  RiRobot2Line,
  RiUserSharedLine,
  RiUserUnfollowLine,
} from '@remixicon/react';
import { useEffect, useState } from 'react';
import { ResizeHandle } from '@/components/layout/resize-handle';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { useResizableWidth } from '@/lib/use-resizable-width';
import { cn } from '@/lib/utils';

export function MemberPanel({
  members,
  aiMode,
  reception,
  onTakeover,
  busy,
  convId,
  isGroup,
  isSelfConv,
  myRole,
  onLeft,
}: {
  members: MemberView[];
  aiMode: string;
  reception: ReceptionView;
  onTakeover: () => void;
  busy: boolean;
  convId: string;
  /** 普通群聊才支持成员管理（direct / avatar_self / 未来的系统会话均隐藏） */
  isGroup: boolean;
  /** 与自己的分身控制通道：不展示接待身份切换 */
  isSelfConv: boolean;
  myRole: string;
  onLeft: () => void;
}) {
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const humans = members.filter((m) => m.principalType === 'human');
  const avatars = members.filter((m) => m.principalType === 'avatar');
  const isDirect = !isGroup && !isSelfConv;
  const peerHuman = isDirect ? humans.find((m) => m.principalId !== myId) : undefined;
  const peerAvatar = peerHuman
    ? avatars.find((m) => m.ownerId === peerHuman.principalId)
    : undefined;
  const peerReception = peerHuman?.reception ?? null;
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
  const [transferOpen, setTransferOpen] = useState(false);
  const [dissolveOpen, setDissolveOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);

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

  const transferOwner = async (targetUserId: string, targetName: string) => {
    setGroupBusy(true);
    try {
      await api.transferOwner(convId, targetUserId);
      await useChatStore.getState().loadMembers(convId);
      await useChatStore.getState().loadConversations();
      setTransferOpen(false);
      toast.success('群主已转让', `${targetName} 现在是群主`);
    } catch (e) {
      toast.error('转让失败', e instanceof Error ? e.message : String(e));
    } finally {
      setGroupBusy(false);
    }
  };

  const dissolve = async () => {
    setGroupBusy(true);
    try {
      await api.dissolveGroup(convId);
      await useChatStore.getState().loadConversations();
      setDissolveOpen(false);
      toast.success('群聊已解散');
      onLeft();
    } catch (e) {
      toast.error('解散失败', e instanceof Error ? e.message : String(e));
    } finally {
      setGroupBusy(false);
    }
  };

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l border-line bg-panel"
    >
      <div
        data-tauri-drag-region
        className="flex select-none items-center justify-between px-4 py-3"
      >
        <h3 data-tauri-drag-region className="text-[13px] font-semibold text-ink">
          {isGroup ? `成员 · ${members.length}` : isSelfConv ? '我的分身' : '对话信息'}
        </h3>
        <div className="flex items-center gap-1">
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" title="更多操作">
                  <RiMoreFill className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent className="w-56">
              {isSelfConv ? (
                <div className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                  这是你与分身的控制通道，直接对话即可。
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-2 py-1.5 text-[11px]">
                    <span className="text-muted-foreground">接待状态</span>
                    <Badge variant={reception.state === 'avatar' ? 'ai' : 'success'}>
                      {RECEPTION_LABELS[reception.state] ?? reception.state}
                      {reception.state === 'avatar'
                        ? ` · ${STRATEGY_LABELS[reception.strategy] ?? reception.strategy}`
                        : ''}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] text-muted-foreground">
                    <span>分身档位</span>
                    <span>
                      {MODE_LABELS[aiMode] ?? aiMode} · v{reception.version}
                    </span>
                  </div>
                  <DropdownMenuSeparator />
                  {reception.state === 'avatar' ? (
                    <DropdownMenuItem disabled={busy} onClick={onTakeover}>
                      <HandRaisedIcon className="size-3.5" />
                      接管对话
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => {
                        void api
                          .release(convId)
                          .then(() => useChatStore.getState().loadConversations())
                          .then(() => toast.success('已交还分身'))
                          .catch((e) =>
                            toast.error('交还失败', e instanceof Error ? e.message : String(e)),
                          );
                      }}
                    >
                      <SparklesIcon className="size-3.5" />
                      交还分身
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {isDirect && peerReception?.state === 'avatar' ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      void api
                        .requestHuman(convId, '希望真人回复')
                        .then(() => toast.success('已请求对方真人'))
                        .catch((e) =>
                          toast.error('请求失败', e instanceof Error ? e.message : String(e)),
                        );
                    }}
                  >
                    <HandRaisedIcon className="size-3.5" />
                    请求对方真人
                  </DropdownMenuItem>
                </>
              ) : null}
              {isGroup && isOwner ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={
                      groupBusy || humans.filter((m) => m.principalId !== myId).length === 0
                    }
                    onClick={() => setTransferOpen(true)}
                  >
                    <RiUserSharedLine className="size-3.5" />
                    转让群主
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                    disabled={groupBusy}
                    onClick={() => setDissolveOpen(true)}
                  >
                    <RiDeleteBin6Line className="size-3.5" />
                    解散群聊
                  </DropdownMenuItem>
                </>
              ) : null}
              {isGroup && !isOwner ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void leave()}>
                    <RiLogoutBoxRLine className="size-3.5" />
                    退出群聊
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2">
        {isDirect ? (
          <>
            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase text-muted-foreground">
              对方
            </p>
            {peerHuman ? <MemberRow member={peerHuman} isMe={false} /> : null}
            {peerAvatar ? (
              <>
                <p className="flex items-center gap-1 px-2 pb-1 pt-2 text-[10px] font-medium uppercase text-muted-foreground">
                  <SparklesIcon className="size-3" /> AI 分身
                </p>
                <MemberRow member={peerAvatar} isMe={false} />
              </>
            ) : null}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
      <AddMembersDialog open={addOpen} onOpenChange={setAddOpen} convId={convId} />

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>转让群主</DialogTitle>
            <DialogDescription>
              转让后你将变为普通成员，无法再管理成员或解散群聊。
            </DialogDescription>
          </DialogHeader>
          <div className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto">
            {humans
              .filter((m) => m.principalId !== myId)
              .map((m) => (
                <button
                  type="button"
                  key={m.principalId}
                  disabled={groupBusy}
                  onClick={() => void transferOwner(m.principalId, m.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  <UserAvatar name={m.name} className="size-7" />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <span className="text-[11px] text-muted-foreground">转让</span>
                </button>
              ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTransferOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dissolveOpen}
        title="解散群聊"
        description="解散后群聊与全部消息将被永久删除，且无法恢复。"
        confirmLabel={groupBusy ? '解散中…' : '解散群聊'}
        destructive
        busy={groupBusy}
        onConfirm={() => void dissolve()}
        onCancel={() => setDissolveOpen(false)}
      />

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
            : member.reception?.state === 'avatar'
              ? `AI 接待 · ${STRATEGY_LABELS[member.reception.strategy] ?? member.reception.strategy}`
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
