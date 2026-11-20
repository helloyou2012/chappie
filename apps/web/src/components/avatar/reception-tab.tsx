import {
  adminApi,
  api,
  type DelegationView,
  RECEPTION_LABELS,
  type ReceptionState,
  type ReceptionStrategy,
  STRATEGY_DESCRIPTIONS,
  STRATEGY_LABELS,
} from '@chappie/shared';
import { RiAddLine, RiDeleteBinLine, RiLoader4Line, RiShieldCheckLine } from '@remixicon/react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';

const SCOPE_LABELS: Record<string, string> = {
  global: '全局（未显式覆盖的会话）',
  contact_group: '联系人分组（标签）',
  contact: '单个联系人（userId）',
  conversation: '单个会话（convId）',
};

const STATES: ReceptionState[] = ['avatar', 'human', 'paused'];
const STRATEGIES: ReceptionStrategy[] = [
  'summon',
  'assist',
  'full',
  'screen',
  'decline',
  'escalate',
  'silent',
  'off',
];

export function ReceptionTab({
  trustLevel,
  onTrustLevel,
}: {
  trustLevel: number;
  onTrustLevel: (n: number) => void;
}) {
  const [rows, setRows] = useState<DelegationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scopeType, setScopeType] = useState<DelegationView['scopeType']>('global');
  const [scopeId, setScopeId] = useState('');
  const [state, setState] = useState<ReceptionState>('avatar');
  const [strategy, setStrategy] = useState<ReceptionStrategy>('full');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDelegations();
      setRows(res.delegations);
    } catch (e) {
      toast.error('加载委托失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      await api.upsertDelegation({
        scopeType,
        scopeId: scopeType === 'global' ? null : scopeId.trim() || null,
        state,
        strategy,
        schedule: start && end ? [{ days: [], start, end }] : [],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      });
      toast.success('委托已保存');
      setOpen(false);
      await load();
    } catch (e) {
      toast.error('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.revokeDelegation(id);
      await load();
      toast.success('委托已撤销');
    } catch (e) {
      toast.error('撤销失败', e instanceof Error ? e.message : String(e));
    }
  };

  const setTrust = async (n: number) => {
    try {
      await adminApi.updateAvatar({ trustLevel: n });
      onTrustLevel(n);
      toast.success('信任等级已更新');
    } catch (e) {
      toast.error('更新失败', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RiShieldCheckLine className="size-4 text-primary" /> 接待权与放权
          </CardTitle>
          <CardDescription className="mt-1">
            全局 / 联系人分组 / 联系人 / 会话四级委托；版本围栏保证接管后旧任务不会继续发送。
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <RiAddLine className="size-3.5" /> 新建委托
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">冷启动信任等级</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                L0 观察 / L1 只出草稿 / L2 低风险自动 / L3 全权
              </p>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={trustLevel === n ? 'default' : 'outline'}
                  onClick={() => void setTrust(n)}
                >
                  L{n}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <RiLoader4Line className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            暂无委托；会话内切换接待态会创建会话级委托。
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="muted">{SCOPE_LABELS[d.scopeType]}</Badge>
                    <Badge variant={d.state === 'avatar' ? 'ai' : 'outline'}>
                      {RECEPTION_LABELS[d.state] ?? d.state}
                    </Badge>
                    <Badge variant="outline">{STRATEGY_LABELS[d.strategy]}</Badge>
                    {d.scopeId ? (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {d.scopeId}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    v{d.version}
                    {d.schedule.length > 0
                      ? ` · 时段 ${d.schedule.map((w) => `${w.start}-${w.end}`).join('、')}`
                      : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="撤销"
                  onClick={() => void remove(d.id)}
                >
                  <RiDeleteBinLine className="size-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建接待委托</DialogTitle>
            <DialogDescription>
              优先级：会话 &gt; 联系人 &gt; 联系人分组 &gt; 全局。时段留空表示全天生效。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">作用域</label>
                <Select
                  value={scopeType}
                  onChange={(e) => setScopeType(e.target.value as DelegationView['scopeType'])}
                >
                  {Object.entries(SCOPE_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">作用域 ID</label>
                <Input
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  disabled={scopeType === 'global'}
                  placeholder={
                    scopeType === 'contact_group'
                      ? '标签，如 家人 / 工作'
                      : scopeType === 'contact'
                        ? '联系人 userId'
                        : '会话 id'
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">接待态</label>
                <Select value={state} onChange={(e) => setState(e.target.value as ReceptionState)}>
                  {STATES.map((s) => (
                    <option key={s} value={s}>
                      {RECEPTION_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">策略</label>
                <Select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as ReceptionStrategy)}
                >
                  {STRATEGIES.map((s) => (
                    <option key={s} value={s}>
                      {STRATEGY_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{STRATEGY_DESCRIPTIONS[strategy]}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">开始（可选）</label>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">结束（可选）</label>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void create()}>
              {busy ? <RiLoader4Line className="size-3 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
