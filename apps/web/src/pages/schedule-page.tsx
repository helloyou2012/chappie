import { type CalendarItem, type TodoItem, adminApi, dayjs } from '@chappie/shared';
import { RiCalendarTodoLine, RiDeleteBinLine, RiLoader4Line } from '@remixicon/react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * 日程与待办 —— 展示分身通过 calendar.create / todo.add 创建的数据。
 * 数据源是 ai-platform 的 toolData（按 avatarId + kind 存储）。
 */
export function SchedulePage() {
  const [tab, setTab] = useState<'calendar' | 'todo'>('calendar');
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [todo, setTodo] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cal, td] = await Promise.all([adminApi.listCalendar(), adminApi.listTodo()]);
      setCalendar(cal.items);
      setTodo(td.items);
    } catch (e) {
      toast.error('加载失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const removeCalendar = async (index: number) => {
    setBusyKey(`cal-${index}`);
    try {
      await adminApi.deleteCalendarItem(index);
      setCalendar((prev) => prev.filter((_, i) => i !== index));
    } catch (e) {
      toast.error('删除日程失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleTodo = async (index: number, done: boolean) => {
    setBusyKey(`todo-${index}`);
    try {
      await adminApi.updateTodoItem(index, { done });
      setTodo((prev) => prev.map((t, i) => (i === index ? { ...t, done } : t)));
    } catch (e) {
      toast.error('更新待办失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const removeTodo = async (index: number) => {
    setBusyKey(`todo-${index}`);
    try {
      await adminApi.deleteTodoItem(index);
      setTodo((prev) => prev.filter((_, i) => i !== index));
    } catch (e) {
      toast.error('删除待办失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const todoPending = todo.filter((t) => !t.done).length;

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.022em]">
              <RiCalendarTodoLine className="size-5 text-primary" /> 日程与待办
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              分身帮你创建的日程和待办都会汇总在这里，也可以在对话里让它继续添加。
            </p>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'calendar' | 'todo')}>
            <TabsList>
              <TabsTrigger value="calendar">日程</TabsTrigger>
              <TabsTrigger value="todo">
                待办{todoPending > 0 ? ` · ${todoPending}` : ''}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        ) : tab === 'calendar' ? (
          calendar.length === 0 ? (
            <EmptyHint text="还没有日程。在对话里对分身说「帮我建个日程，明天 10 点产品评审」试试。" />
          ) : (
            <div className="space-y-3">
              {calendar.map((item, index) => (
                <Card key={`${item.date ?? ''}-${item.time}-${item.title}-${index}`}>
                  <CardContent className="flex items-center gap-3 py-4">
                    <Badge
                      variant={
                        item.date && dayjs(item.date).isSame(dayjs(), 'day') ? 'ai' : 'muted'
                      }
                      className="shrink-0 font-mono text-[11px]"
                    >
                      {item.date ? `${formatEventDate(item.date)} ${item.time}` : item.time}
                    </Badge>
                    <p className="min-w-0 flex-1 truncate text-sm">{item.title}</p>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={busyKey !== null}
                      onClick={() => void removeCalendar(index)}
                      aria-label="删除日程"
                      title="删除日程"
                    >
                      {busyKey === `cal-${index}` ? (
                        <RiLoader4Line className="size-3.5 animate-spin" />
                      ) : (
                        <RiDeleteBinLine className="size-3.5" />
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : todo.length === 0 ? (
          <EmptyHint text="待办清单是空的。对分身说「加个待办：回复 Bob 的邮件」即可。" />
        ) : (
          <div className="space-y-3">
            {todo.map((item, index) => (
              <Card key={`${item.text}-${index}`}>
                <CardContent className="flex items-center gap-3 py-4">
                  <Switch
                    checked={item.done}
                    disabled={busyKey !== null}
                    onCheckedChange={(checked) => void toggleTodo(index, checked)}
                    aria-label={item.done ? '标记为未完成' : '标记为已完成'}
                  />
                  <p
                    className={cn(
                      'min-w-0 flex-1 text-sm break-words',
                      item.done && 'text-muted-foreground line-through',
                    )}
                  >
                    {item.text}
                  </p>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={busyKey !== null}
                    onClick={() => void removeTodo(index)}
                    aria-label="删除待办"
                    title="删除待办"
                  >
                    {busyKey === `todo-${index}` ? (
                      <RiLoader4Line className="size-3.5 animate-spin" />
                    ) : (
                      <RiDeleteBinLine className="size-3.5" />
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-6 text-[11px] text-muted-foreground">
          查询与新增走分身的日程/待办能力（L0 只读 / L1 低风险写），删除和完成状态仅在本页管理。
        </p>
      </div>
    </div>
  );
}

/** 事件日期显示：今天 / 明天 / M月D日；无日期（旧数据未解析）时留空 */
function formatEventDate(date: string | null | undefined): string {
  if (!date) return '';
  const d = dayjs(date);
  if (!d.isValid()) return '';
  if (d.isSame(dayjs(), 'day')) return '今天';
  if (d.isSame(dayjs().add(1, 'day'), 'day')) return '明天';
  return d.isSame(dayjs(), 'year') ? d.format('M月D日') : d.format('YYYY年M月D日');
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
