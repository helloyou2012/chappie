import {
  adminApi,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  type Policy,
  RISK_LABELS,
  type RiskLevel,
} from '@chappie/shared';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { RiAddLine, RiDeleteBinLine, RiLoader4Line } from '@remixicon/react';
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
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const SCOPE_LABEL: Record<string, string> = {
  global: '全局默认',
  contact: '联系人',
  contact_group: '联系人分组',
  conversation: '会话',
  schedule: '场景/日程',
};

const MODES = ['manual', 'draft', 'auto', 'off'] as const;
const RISKS: RiskLevel[] = ['L0', 'L1', 'L2', 'L3'];

export function PolicyTab() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [scopeType, setScopeType] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState('auto');
  const [maxRisk, setMaxRisk] = useState<RiskLevel>('L1');
  const [rateLimit, setRateLimit] = useState('20');
  const [denyTopics, setDenyTopics] = useState('money');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listPolicies();
      setPolicies(res.policies);
    } catch (e) {
      toast.error('加载策略失败', e instanceof Error ? e.message : String(e));
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
      await adminApi.createPolicy({
        scopeType,
        scopeId: scopeId.trim() || null,
        name: name.trim() || `${SCOPE_LABEL[scopeType]}策略`,
        rule: {
          mode: mode as Policy['rule']['mode'],
          schedule: [],
          allowCapabilities: null,
          denyTopics: denyTopics
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
          maxRisk,
          rateLimitPerHour: Number(rateLimit) || 20,
          escalateWhen: ['confidence<0.7'],
        },
      });
      toast.success('策略已创建');
      setOpen(false);
      await load();
    } catch (e) {
      toast.error('创建失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p: Policy) => {
    try {
      await adminApi.updatePolicy(p.id, { enabled: !p.enabled });
      await load();
    } catch (e) {
      toast.error('更新失败', String(e));
    }
  };

  const remove = async (p: Policy) => {
    if (!confirm(`删除策略「${p.name || SCOPE_LABEL[p.scopeType]}」？`)) return;
    try {
      await adminApi.deletePolicy(p.id);
      await load();
      toast.success('已删除');
    } catch (e) {
      toast.error('删除失败', String(e));
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheckIcon className="size-4 text-primary" /> 策略与档位
          </CardTitle>
          <CardDescription className="mt-1">
            会话档位优先；策略提供兜底档位与约束（风险上限、禁区话题、频率）。
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <RiAddLine className="size-3.5" /> 新建策略
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <RiLoader4Line className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : policies.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无策略</p>
        ) : (
          <div className="space-y-2">
            {policies.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">
                      {p.name || SCOPE_LABEL[p.scopeType]}
                    </span>
                    <Badge variant="muted">{SCOPE_LABEL[p.scopeType]}</Badge>
                    {p.scopeId ? (
                      <Badge variant="outline" className="text-[10px]">
                        {p.scopeId.slice(0, 18)}
                      </Badge>
                    ) : null}
                    <Badge variant="ai">{MODE_LABELS[p.rule.mode]}</Badge>
                    <Badge variant="outline">上限 {RISK_LABELS[p.rule.maxRisk]}</Badge>
                    {p.rule.rateLimitPerHour ? (
                      <Badge variant="outline">{p.rule.rateLimitPerHour}/小时</Badge>
                    ) : null}
                  </div>
                  {p.rule.denyTopics.length > 0 ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      禁区话题：{p.rule.denyTopics.join('、')}
                    </p>
                  ) : null}
                </div>
                <Switch checked={p.enabled} onCheckedChange={() => void toggle(p)} />
                <Button variant="ghost" size="icon-sm" onClick={() => void remove(p)} title="删除">
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
            <DialogTitle>新建策略</DialogTitle>
            <DialogDescription>
              作用域优先级：会话（档位开关）&gt; 联系人 &gt; 场景 &gt; 全局默认。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">作用域</label>
                <Select value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
                  {Object.entries(SCOPE_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  作用域 ID{scopeType === 'global' ? '（全局无需填写）' : ''}
                </label>
                <Input
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  placeholder={
                    scopeType === 'contact'
                      ? '联系人 userId'
                      : scopeType === 'conversation'
                        ? '会话 id'
                        : '可选'
                  }
                  disabled={scopeType === 'global'}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">名称</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：家人自动档"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">兜底档位</label>
              <div className="flex gap-1">
                {MODES.map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 text-[12px] transition-colors',
                      mode === m
                        ? 'bg-surface-selected text-ink'
                        : 'bg-surface-veil text-ink-tertiary hover:bg-surface-hover hover:text-ink',
                    )}
                    title={MODE_DESCRIPTIONS[m]}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">自动执行风险上限</label>
              <div className="flex gap-1">
                {RISKS.map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setMaxRisk(r)}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 text-[12px] transition-colors',
                      maxRisk === r
                        ? 'bg-surface-selected text-ink'
                        : 'bg-surface-veil text-ink-tertiary hover:bg-surface-hover hover:text-ink',
                    )}
                  >
                    {r} {RISK_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">每小时上限</label>
                <Input
                  type="number"
                  min="1"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">禁区话题（逗号分隔）</label>
                <Input
                  value={denyTopics}
                  onChange={(e) => setDenyTopics(e.target.value)}
                  placeholder="money, health"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? <RiLoader4Line className="size-4 animate-spin" /> : null}
              创建
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
