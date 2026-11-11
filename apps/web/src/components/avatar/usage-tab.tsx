import { adminApi, type UsageDay } from '@chappie/shared';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import { RiCoinsLine, RiLoader4Line } from '@remixicon/react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/toast';

export function UsageTab() {
  const [usage, setUsage] = useState<UsageDay[]>([]);
  const [todayCost, setTodayCost] = useState(0);
  const [budget, setBudget] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .getUsage(14)
      .then((res) => {
        setUsage(res.usage);
        setTodayCost(res.todayCostUsd);
        setBudget(res.dailyBudgetUsd);
      })
      .catch((e) => toast.error('加载用量失败', e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const pct = budget > 0 ? Math.min(100, (todayCost / budget) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <RiCoinsLine className="size-4 text-primary" /> 今日用量与预算
          </CardTitle>
          <CardDescription>按分身为粒度归因；超额自动降为手动档并通知你。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex items-end justify-between text-sm">
            <span className="font-semibold tabular-nums">${todayCost.toFixed(4)}</span>
            <span className="text-xs text-muted-foreground">预算 ${budget.toFixed(2)}</span>
          </div>
          <Progress value={pct} />
          <p className="mt-1.5 text-[10px] text-muted-foreground">已使用 {pct.toFixed(1)}%</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ChartBarIcon className="size-4 text-primary" /> 近 14 天明细
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <RiLoader4Line className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : usage.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无用量记录</p>
          ) : (
            <div className="scrollbar-thin max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">日期</th>
                    <th className="py-1.5 pr-2 font-medium">供应商 / 模型</th>
                    <th className="py-1.5 pr-2 text-right font-medium">请求</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Tokens</th>
                    <th className="py-1.5 text-right font-medium">花费</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u, i) => (
                    <tr key={i} className="transition-colors hover:bg-surface-raised">
                      <td className="py-1.5 pr-2 tabular-nums">{u.day}</td>
                      <td className="py-1.5 pr-2">
                        {u.provider}
                        <span className="text-muted-foreground"> / {u.model}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{u.requests}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {(u.inputTokens + u.outputTokens).toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">${u.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
