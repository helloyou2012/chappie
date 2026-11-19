import {
  adminApi,
  api,
  type ContactView,
  type ConversationView,
  groupByInitial,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  type Policy,
} from '@chappie/shared';
import { UserPlusIcon, UsersIcon } from '@heroicons/react/24/outline';
import {
  RiChat3Line,
  RiDeleteBinLine,
  RiGroupLine,
  RiLoader4Line,
  RiPencilLine,
  RiRobot2Line,
  RiSearchLine,
} from '@remixicon/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const MODES = ['manual', 'draft', 'auto', 'off'] as const;

function displayName(c: ContactView): string {
  return c.alias?.trim() || c.user.name;
}

/** 联系人作用域策略：为「对 TA 的分身档位」提供读写 */
function contactPolicy(policies: Policy[], peerId: string): Policy | undefined {
  return policies.find((p) => p.scopeType === 'contact' && p.scopeId === peerId);
}

export function ContactsPage() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [groups, setGroups] = useState<ConversationView[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  const [aliasTarget, setAliasTarget] = useState<ContactView | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  const [modeTarget, setModeTarget] = useState<ContactView | null>(null);
  const [mode, setMode] = useState<(typeof MODES)[number]>('manual');
  const [savingMode, setSavingMode] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContactView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactRes, policyRes, convRes] = await Promise.all([
        api.listContacts(),
        adminApi.listPolicies(),
        api.listConversations(),
      ]);
      setContacts(contactRes.contacts);
      setPolicies(policyRes.policies);
      setGroups(
        convRes.views.filter(
          (v) => v.conversation.type === 'group' && v.conversation.systemTag === null,
        ),
      );
    } catch (e) {
      toast.error('加载联系人失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.user.name.toLowerCase().includes(q) ||
        c.user.email.toLowerCase().includes(q) ||
        (c.alias ?? '').toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const grouped = useMemo(() => groupByInitial(filtered, (c) => displayName(c)), [filtered]);

  const add = async () => {
    const value = email.trim();
    if (!value) return;
    setAdding(true);
    try {
      const res = await api.addContact({ email: value });
      setContacts((prev) =>
        prev.some((c) => c.user.id === res.contact.user.id) ? prev : [...prev, res.contact],
      );
      setEmail('');
      toast.success('已添加联系人', res.contact.user.name);
    } catch (e) {
      toast.error('添加失败', e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const openAlias = (c: ContactView) => {
    setAliasTarget(c);
    setAliasDraft(c.alias ?? '');
  };

  const saveAlias = async () => {
    if (!aliasTarget) return;
    setSavingAlias(true);
    try {
      const res = await api.updateContact(aliasTarget.user.id, {
        alias: aliasDraft.trim() || null,
      });
      setContacts((prev) => prev.map((c) => (c.user.id === res.contact.user.id ? res.contact : c)));
      setAliasTarget(null);
      toast.success(aliasDraft.trim() ? '备注名已更新' : '已清除备注名');
    } catch (e) {
      toast.error('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAlias(false);
    }
  };

  const openMode = (c: ContactView) => {
    setModeTarget(c);
    setMode(contactPolicy(policies, c.user.id)?.rule.mode ?? 'manual');
  };

  const saveMode = async () => {
    if (!modeTarget) return;
    setSavingMode(true);
    try {
      const existing = contactPolicy(policies, modeTarget.user.id);
      if (existing) {
        await adminApi.updatePolicy(existing.id, { rule: { ...existing.rule, mode } });
      } else {
        await adminApi.createPolicy({
          scopeType: 'contact',
          scopeId: modeTarget.user.id,
          name: `联系人 · ${displayName(modeTarget)}`,
          rule: {
            mode,
            schedule: [],
            allowCapabilities: null,
            denyTopics: [],
            maxRisk: 'L1',
            rateLimitPerHour: 20,
            escalateWhen: ['confidence<0.7'],
          },
        });
      }
      const res = await adminApi.listPolicies();
      setPolicies(res.policies);
      setModeTarget(null);
      toast.success('已更新我的分身档位', `${displayName(modeTarget)}：${MODE_LABELS[mode]}`);
    } catch (e) {
      toast.error('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMode(false);
    }
  };

  const confirmRemove = async () => {
    const target = removeTarget;
    if (!target) return;
    setBusyId(target.user.id);
    try {
      await api.removeContact(target.user.id);
      setContacts((prev) => prev.filter((x) => x.user.id !== target.user.id));
      setRemoveTarget(null);
      toast.success('已移除联系人');
    } catch (e) {
      toast.error('移除失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const startChat = async (c: ContactView) => {
    setBusyId(c.user.id);
    try {
      const res = await api.createConversation({
        type: 'direct',
        memberUserIds: [c.user.id],
      });
      navigate(`/chat/${res.view.conversation.id}`);
    } catch (e) {
      toast.error('发起会话失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.022em]">
              <UsersIcon className="size-5 text-primary" /> 联系人
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              联系人决定谁能与你建立单聊；也可为某个人单独设定「你的分身」的档位（不会修改对方分身）。
            </p>
          </div>
          <Badge variant="muted">{contacts.length} 人</Badge>
        </div>

        {/* 添加 + 搜索 */}
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-2 py-4">
            <div className="relative min-w-56 flex-1">
              <UserPlusIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-quaternary" />
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
                placeholder="按邮箱添加联系人（对方需已注册）"
                type="email"
                className="pl-8"
              />
            </div>
            <Button onClick={() => void add()} disabled={adding || !email.trim()}>
              {adding ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
              添加
            </Button>
            <div className="relative w-full sm:w-56">
              <RiSearchLine className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-quaternary" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索姓名 / 邮箱 / 备注"
                className="pl-7"
              />
            </div>
          </CardContent>
        </Card>

        {/* 常驻入口：群聊 */}
        <Card className="mb-4">
          <button
            type="button"
            onClick={() => setGroupsOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-veil"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-surface-raised text-ink-secondary">
              <RiGroupLine className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">群聊</div>
              <p className="text-xs text-muted-foreground">{groups.length} 个群聊</p>
            </div>
            <span className="text-ink-quaternary">›</span>
          </button>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16">
            <RiLoader4Line className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
            {contacts.length === 0
              ? '还没有联系人：在上方按邮箱添加，对方注册后即可发起会话。'
              : '没有匹配的联系人。'}
          </div>
        ) : (
          <div className="relative space-y-4">
            {grouped.map((section) => (
              <div
                key={section.title}
                ref={(el) => {
                  sectionRefs.current[section.title] = el;
                }}
                className="scroll-mt-2"
              >
                <div className="sticky top-0 z-10 -mx-1 mb-1 bg-view/95 px-1 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                  {section.title}
                </div>
                <div className="space-y-2">
                  {section.data.map((c) => {
                    const policy = contactPolicy(policies, c.user.id);
                    return (
                      <Card key={c.user.id}>
                        <CardContent className="flex flex-wrap items-center gap-3 py-3">
                          <UserAvatar name={c.user.name} className="size-9" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{displayName(c)}</span>
                              {c.alias ? (
                                <Badge variant="outline" className="text-[10px]">
                                  备注
                                </Badge>
                              ) : null}
                              <Badge variant="ai">
                                <RiRobot2Line className="size-2.5" />
                                {policy ? MODE_LABELS[policy.rule.mode] : '默认档位'}
                              </Badge>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {c.alias ? `${c.user.name} · ` : ''}
                              {c.user.email}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openMode(c)}
                              title="设定我的分身对 TA 的档位"
                            >
                              <RiRobot2Line className="size-3" /> 档位
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openAlias(c)}
                              title="编辑备注名"
                            >
                              <RiPencilLine className="size-3" /> 备注
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void startChat(c)}
                              disabled={busyId === c.user.id}
                            >
                              {busyId === c.user.id ? (
                                <RiLoader4Line className="size-3 animate-spin" />
                              ) : (
                                <RiChat3Line className="size-3" />
                              )}
                              发消息
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setRemoveTarget(c)}
                              disabled={busyId === c.user.id}
                              title="移除联系人"
                            >
                              <RiDeleteBinLine className="size-3.5 text-destructive" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* 右侧字母索引 */}
            <div className="fixed right-2 top-1/3 z-20 hidden flex-col items-center gap-0.5 lg:flex">
              {grouped.map((section) => (
                <button
                  key={section.title}
                  type="button"
                  onClick={() =>
                    sectionRefs.current[section.title]?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                  className="px-1 text-[10px] text-ink-tertiary transition-colors hover:text-ink"
                >
                  {section.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 备注名 */}
      <Dialog open={aliasTarget !== null} onOpenChange={(v) => !v && setAliasTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑备注名</DialogTitle>
            <DialogDescription>
              {aliasTarget ? `${aliasTarget.user.name} · ${aliasTarget.user.email}` : ''}
              ；留空表示清除备注。
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={aliasDraft}
            maxLength={40}
            onChange={(e) => setAliasDraft(e.target.value)}
            placeholder="如：大学室友 / 王总"
          />
          <DialogFooter>
            <Button onClick={() => void saveAlias()} disabled={savingAlias}>
              {savingAlias ? <RiLoader4Line className="size-4 animate-spin" /> : null}
              保存
            </Button>
            <Button variant="ghost" onClick={() => setAliasTarget(null)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 对 TA 的分身档位 */}
      <Dialog open={modeTarget !== null} onOpenChange={(v) => !v && setModeTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              我的分身对「{modeTarget ? displayName(modeTarget) : ''}」的档位
            </DialogTitle>
            <DialogDescription>
              只影响你的分身与 TA
              的私聊表现，不会修改对方分身的设置；会话内单独切换的档位优先级更高。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-md border px-3 py-2.5 text-left transition-colors',
                  mode === m
                    ? 'border-primary bg-surface-selected'
                    : 'border-line hover:bg-surface-hover',
                )}
              >
                <div className="text-[13px] font-medium">{MODE_LABELS[m]}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {MODE_DESCRIPTIONS[m]}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => void saveMode()} disabled={savingMode}>
              {savingMode ? <RiLoader4Line className="size-4 animate-spin" /> : null}
              保存
            </Button>
            <Button variant="ghost" onClick={() => setModeTarget(null)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget !== null}
        title="移除联系人"
        description={
          removeTarget
            ? `从联系人中移除「${displayName(removeTarget)}」？已有会话不受影响。`
            : undefined
        }
        confirmLabel="移除"
        destructive
        busy={removeTarget !== null && busyId === removeTarget.user.id}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveTarget(null)}
      />

      {/* 群聊列表 */}
      <Dialog open={groupsOpen} onOpenChange={setGroupsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>群聊</DialogTitle>
            <DialogDescription>你参与的全部群聊（含对方分身）。</DialogDescription>
          </DialogHeader>
          <div className="scrollbar-thin max-h-80 space-y-1 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">还没有群聊</p>
            ) : (
              groups.map((g) => (
                <button
                  type="button"
                  key={g.conversation.id}
                  onClick={() => {
                    setGroupsOpen(false);
                    navigate(`/chat/${g.conversation.id}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <UserAvatar name={g.displayTitle} variant="group" className="size-8" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{g.displayTitle}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {g.lastMsgPreview ?? '暂无消息'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
