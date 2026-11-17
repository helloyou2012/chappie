import { adminApi, type CalendarItem, dayjs, type TodoItem } from '@chappie/shared';
import {
  RiAddLine,
  RiCalendarLine,
  RiCalendarTodoLine,
  RiCheckboxCircleLine,
  RiDeleteBinLine,
  RiLoader4Line,
} from '@remixicon/react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
  const [createOpen, setCreateOpen] = useState<'calendar' | 'todo' | null>(null);
  const [creating, setCreating] = useState(false);
  const [calTitle, setCalTitle] = useState('');
  const [calDate, setCalDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [calTime, setCalTime] = useState('10:00');
  const [todoText, setTodoText] = useState('');

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

  const openCreate = (kind: 'calendar' | 'todo') => {
    setCreateOpen(kind);
    if (kind === 'calendar') {
      setCalTitle('');
      setCalDate(dayjs().format('YYYY-MM-DD'));
      setCalTime('10:00');
    } else {
      setTodoText('');
    }
  };

  const create = async () => {
    if (!createOpen) return;
    setCreating(true);
    try {
      if (createOpen === 'calendar') {
        if (!calTitle.trim()) return;
        await adminApi.createCalendarItem({
          title: calTitle.trim(),
          date: calDate || null,
          time: calTime.trim() || '10:00',
        });
        toast.success('日程已创建');
      } else {
        if (!todoText.trim()) return;
        await adminApi.createTodoItem({ text: todoText.trim() });
        toast.success('待办已添加');
      }
      setCreateOpen(null);
      await load();
    } catch (e) {
      toast.error('创建失败', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

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
          <div className="flex items-center gap-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'calendar' | 'todo')}>
              <TabsList>
                <TabsTrigger value="calendar">日程</TabsTrigger>
                <TabsTrigger value="todo">
                  待办{todoPending > 0 ? ` · ${todoPending}` : ''}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              onClick={() => openCreate(tab)}
              title={tab === 'calendar' ? '新建日程' : '新建待办'}
            >
              <RiAddLine className="size-3.5" />
              {tab === 'calendar' ? '新建日程' : '新建待办'}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        ) : tab === 'calendar' ? (
          calendar.length === 0 ? (
            <EmptyHint text="还没有日程。点右上角「新建日程」，或直接对分身说「明天 10 点产品评审」。" />
          ) : (
            <div className="space-y-3">
              {calendar.map((item, index) => (
                <Card key={item.id ?? `${item.date ?? ''}-${item.time}-${item.title}`}>
                  <CardContent className="flex items-center gap-3 py-3.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-brand">
                      <RiCalendarLine className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.date ? `${formatEventDate(item.date)} ${item.time}` : item.time}
                        {item.date && dayjs(item.date).isSame(dayjs(), 'day') ? ' · 今天' : ''}
                      </p>
                    </div>
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
          <EmptyHint text="待办清单是空的。点右上角「新建待办」，或对分身说「加个待办：回复 Bob 的邮件」。" />
        ) : (
          <div className="space-y-3">
            {todo.map((item, index) => (
              <Card key={`${item.text}-${item.done}`}>
                <CardContent className="flex items-center gap-3 py-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success">
                    <RiCheckboxCircleLine className="size-4" />
                  </span>
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
          分身与本页共享同一份日程/待办数据；日程到点会由分身主动提醒。
        </p>
      </div>

      {/* 新建日程 / 待办 */}
      <Dialog open={createOpen !== null} onOpenChange={(v) => !v && setCreateOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{createOpen === 'calendar' ? '新建日程' : '新建待办'}</DialogTitle>
          </DialogHeader>
          {createOpen === 'calendar' ? (
            <div className="space-y-3">
              <Input
                autoFocus
                value={calTitle}
                onChange={(e) => setCalTitle(e.target.value)}
                placeholder="日程标题，如「产品评审会」"
                maxLength={100}
              />
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={calDate}
                  onChange={(e) => setCalDate(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="time"
                  value={calTime}
                  onChange={(e) => setCalTime(e.target.value)}
                  className="w-28"
                />
              </div>
            </div>
          ) : (
            <Input
              autoFocus
              value={todoText}
              onChange={(e) => setTodoText(e.target.value)}
              placeholder="待办内容，如「回复 Bob 的邮件」"
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
          )}
          <DialogFooter>
            <Button onClick={() => void create()} disabled={creating}>
              {creating ? <RiLoader4Line className="size-4 animate-spin" /> : null}
              创建
            </Button>
            <Button variant="ghost" onClick={() => setCreateOpen(null)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
