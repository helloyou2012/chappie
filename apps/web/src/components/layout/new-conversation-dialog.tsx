import { api, type User, useChatStore } from '@chappie/shared';
import { UsersIcon } from '@heroicons/react/24/outline';
import { RiCheckLine, RiLoader4Line } from '@remixicon/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export function NewConversationDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const loadConversations = useChatStore((s) => s.loadConversations);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .directory()
      .then((r) => setUsers(r.users))
      .catch((e) => toast.error('加载联系人失败', e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setTitle('');
      setTab('direct');
    }
  }, [open]);

  const toggle = (id: string) => {
    if (tab === 'direct') {
      setSelected([id]);
    } else {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    }
  };

  const create = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const res = await api.createConversation({
        type: tab,
        memberUserIds: selected,
        title: tab === 'group' ? title.trim() || '新群聊' : undefined,
      });
      await loadConversations();
      setOpen(false);
      navigate(`/chat/${res.view.conversation.id}`);
    } catch (e) {
      toast.error('创建会话失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建会话</DialogTitle>
          <DialogDescription>
            选择联系人发起单聊，或创建群聊。对方与双方的分身会一同加入。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as 'direct' | 'group');
            setSelected([]);
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="direct" className="flex-1">
              单聊
            </TabsTrigger>
            <TabsTrigger value="group" className="flex-1">
              群聊
            </TabsTrigger>
          </TabsList>

          <TabsContent value="direct">
            <UserList
              users={users}
              loading={loading}
              selected={selected}
              onToggle={toggle}
              single
            />
          </TabsContent>
          <TabsContent value="group">
            <div className="space-y-3">
              <Input
                placeholder="群聊名称（可选）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <UserList users={users} loading={loading} selected={selected} onToggle={toggle} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button onClick={() => void create()} disabled={busy || selected.length === 0}>
            {busy ? <RiLoader4Line className="size-4 animate-spin" /> : null}
            {tab === 'direct' ? '发起单聊' : `创建群聊（${selected.length}）`}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserList({
  users,
  loading,
  selected,
  onToggle,
  single,
}: {
  users: User[];
  loading: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  single?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <RiLoader4Line className="size-4 animate-spin" />
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground">
        <UsersIcon className="size-6" />
        <p>暂时没有其他用户。可在另一个窗口注册账号后再试。</p>
      </div>
    );
  }
  return (
    <div className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto">
      {users.map((u) => {
        const checked = selected.includes(u.id);
        return (
          <button
            type="button"
            key={u.id}
            onClick={() => onToggle(u.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors',
              checked ? 'bg-accent' : 'hover:bg-muted/70',
            )}
          >
            <UserAvatar name={u.name} className="size-8" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{u.name}</div>
              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
            </div>
            {checked ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <RiCheckLine className="size-3" />
              </span>
            ) : single ? (
              <span className="size-5 rounded-full border" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
