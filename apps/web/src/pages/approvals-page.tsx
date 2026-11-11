import { type Approval, adminApi, api, formatRelative, RISK_LABELS } from '@chappie/shared';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { RiCheckLine, RiCloseLine, RiLoader4Line, RiTimeLine } from '@remixicon/react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<string, string> = {
  pending: '待确认',
  approved: '已批准',
  modified: '修改后批准',
  rejected: '已拒绝',
  expired: '已超时',
};

export function ApprovalsPage() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (status: 'pending' | 'all') => {
    setLoading(true);
    try {
      const res = await adminApi.listApprovals(
        status === 'pending' ? { status: 'pending' } : undefined,
      );
      setApprovals(res.approvals);
    } catch (e) {
      toast.error('加载审批失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const resolve = async (a: Approval, action: 'approve' | 'reject') => {
    if (!a.cardMsgId) {
      toast.error('找不到卡片消息', '请到「我的分身」会话中处理');
      return;
    }
    setBusyId(a.id);
    try {
      await api.cardAction(a.cardMsgId, { action });
      toast.success(action === 'approve' ? '已批准' : '已拒绝');
      await load(tab);
    } catch (e) {
      toast.error('操作失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.022em]">
              <ShieldCheckIcon className="size-5 text-primary" /> 审批中心
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              分身代你执行高风险操作（L2）前会在这里等待确认，超时自动拒绝。
            </p>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'all')}>
            <TabsList>
              <TabsTrigger value="pending">待确认</TabsTrigger>
              <TabsTrigger value="all">全部</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-md" />
            ))}
          </div>
        ) : approvals.length === 0 ? (
          <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
            暂无审批请求
          </div>
        ) : (
          <div className="space-y-3">
            {approvals.map((a) => (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-sm">{a.title}</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        工具 {a.toolName} · {formatRelative(a.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {a.status === 'pending' ? (
                        <Badge variant="warning">
                          <RiTimeLine className="size-2.5" /> 待确认
                        </Badge>
                      ) : (
                        <Badge
                          variant={
                            a.status === 'approved' || a.status === 'modified'
                              ? 'success'
                              : a.status === 'expired'
                                ? 'muted'
                                : 'destructive'
                          }
                        >
                          {STATUS_LABEL[a.status] ?? a.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="mb-3 max-h-28 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap break-all">
                    {JSON.stringify(a.args, null, 2)}
                  </pre>
                  <div className="flex items-center justify-between">
                    <span className={cn('text-[10px] text-muted-foreground')}>
                      请求时间 {formatRelative(a.createdAt)} · 超时时间{' '}
                      {formatRelative(a.expiresAt)}
                    </span>
                    {a.status === 'pending' ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === a.id}
                          onClick={() => void resolve(a, 'approve')}
                        >
                          {busyId === a.id ? (
                            <RiLoader4Line className="size-3 animate-spin" />
                          ) : (
                            <RiCheckLine className="size-3" />
                          )}
                          批准
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === a.id}
                          onClick={() => void resolve(a, 'reject')}
                        >
                          <RiCloseLine className="size-3" /> 拒绝
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-6 flex items-center gap-1 text-[11px] text-muted-foreground">
          <ShieldCheckIcon className="size-3" />
          {RISK_LABELS.L2}类操作必须由你确认；分身永不自动执行 L3 能力。
        </p>
      </div>
    </div>
  );
}
