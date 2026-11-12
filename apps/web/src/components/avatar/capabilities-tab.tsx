import { adminApi, type CapabilityGrant, RISK_LABELS } from '@chappie/shared';
import { RiLoader4Line, RiToolsLine } from '@remixicon/react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface CapRow {
  capability: {
    id: string;
    name: string;
    description: string;
    riskLevel: string;
    provider: string;
    version: number;
    schema: Record<string, unknown>;
  };
  grant: CapabilityGrant;
}

const riskBadge: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  L0: 'success',
  L1: 'muted',
  L2: 'warning',
  L3: 'destructive',
};

export function CapabilitiesTab() {
  const [rows, setRows] = useState<CapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listCapabilities();
      setRows(res.capabilities as CapRow[]);
    } catch (e) {
      toast.error('加载能力失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (row: CapRow) => {
    setBusyId(row.capability.id);
    try {
      const granted = !row.grant.granted;
      await adminApi.updateGrant(row.capability.id, { granted });
      setRows((prev) =>
        prev.map((r) =>
          r.capability.id === row.capability.id ? { ...r, grant: { ...r.grant, granted } } : r,
        ),
      );
      toast.success(granted ? '已授权' : '已收回授权', row.capability.name);
    } catch (e) {
      toast.error('更新失败', String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <RiToolsLine className="size-4 text-primary" /> 能力授权
        </CardTitle>
        <CardDescription>
          分身只能调用你授权的工具；L2 高风险操作仍需逐次确认，L3 永不自动执行。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <RiLoader4Line className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.capability.id}
                className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{row.capability.name}</span>
                    <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                      {row.capability.id}
                    </code>
                    <Badge variant={riskBadge[row.capability.riskLevel] ?? 'muted'}>
                      {row.capability.riskLevel} ·{' '}
                      {RISK_LABELS[row.capability.riskLevel] ?? row.capability.riskLevel}
                    </Badge>
                  </div>
                  <p
                    className={cn(
                      'mt-0.5 text-xs text-muted-foreground',
                      row.capability.riskLevel === 'L2' && 'text-warning',
                    )}
                  >
                    {row.capability.description}
                    {row.capability.riskLevel === 'L2' ? '（每次执行需你确认）' : ''}
                  </p>
                </div>
                {busyId === row.capability.id ? (
                  <RiLoader4Line className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <Switch checked={row.grant.granted} onCheckedChange={() => void toggle(row)} />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
