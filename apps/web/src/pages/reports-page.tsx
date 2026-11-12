import { adminApi, type DailyReport, dayjs } from '@chappie/shared';
import { ArrowTrendingUpIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
  RiTaskLine,
} from '@remixicon/react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ReportsPage() {
  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async (day: string) => {
    setLoading(true);
    try {
      const res = await adminApi.getDailyReport(day);
      setReport(res.report);
    } catch (e) {
      if (String(e).includes('avatar_not_ready')) {
        setTimeout(() => void load(day), 1500);
        return;
      }
      toast.error('加载日报失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await adminApi.generateReport();
      setReport(res.report);
      toast.success('日报已生成', '同时已推送一张日报卡片到「我的分身」会话');
    } catch (e) {
      toast.error('生成失败', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.022em]">
              <CalendarDaysIcon className="size-5 text-primary" /> 分身日报
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              分身替你回复了谁、做了什么、有哪些待你决定。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              inputSize="sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
            <Button variant="outline" size="sm" onClick={() => void load(date)} disabled={loading}>
              {loading ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiRefreshLine className="size-3.5" />
              )}
              刷新
            </Button>
            <Button size="sm" onClick={() => void generate()} disabled={generating}>
              {generating ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
              立即生成
            </Button>
          </div>
        </div>

        {loading && !report ? (
          <Skeleton className="h-64 w-full rounded-md" />
        ) : !report ? (
          <div className="rounded-md border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">这一天还没有日报</p>
            <Button
              className="mt-3"
              size="sm"
              onClick={() => void generate()}
              disabled={generating}
            >
              生成日报
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">今日概述 · {report.day}</CardTitle>
                  <Badge variant="ai">AI 分身</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">{report.summary}</p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="代发回复" value={report.stats.repliedCount} />
              <Stat label="完成任务" value={report.stats.tasksCompleted} />
              <Stat label="草稿采纳" value={report.stats.draftsSent} />
              <Stat label="草稿丢弃" value={report.stats.draftsDiscarded} />
              <Stat label="转交人工" value={report.stats.handovers} />
              <Stat label="采纳率" value={`${(report.stats.acceptedRate * 100).toFixed(0)}%`} />
            </div>

            <Card>
              <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
                <RiTaskLine className="size-4 text-primary" />
                <CardTitle className="text-sm">待你决定</CardTitle>
              </CardHeader>
              <CardContent>
                {report.pendingDecisions.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RiCheckboxCircleLine className="size-3.5 text-success" /> 没有待处理事项
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {report.pendingDecisions.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <RiErrorWarningLine className="mt-0.5 size-3.5 shrink-0 text-warning" />
                        <span>
                          <span className="font-medium">{d.title}</span>
                          {d.detail ? (
                            <span className="text-muted-foreground"> · {d.detail}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ArrowTrendingUpIcon className="size-3" /> 今日花费 $
                {(report.stats.costUsd ?? 0).toFixed(4)}
              </span>
              <span>生成于 {dayjs(report.createdAt).format('YYYY-MM-DD HH:mm')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
