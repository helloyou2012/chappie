import { adminApi, dayjs, type TodoItem, useAuthStore } from '@chappie/shared';
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckboxBlankCircleLine,
  RiCheckboxCircleFill,
  RiCheckLine,
  RiDeleteBinLine,
  RiInboxLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSearchLine,
  RiTimeLine,
} from '@remixicon/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type CalendarView,
  type Dayjs,
  formatMinutes,
  nextSlotTime,
  normalizeEvent,
  type ScheduleEvent,
  startOfWeek,
  viewTitle,
} from '@/components/schedule/calendar-utils';
import {
  CreateEventDialog,
  EditEventDialog,
  EventDetailDialog,
} from '@/components/schedule/event-dialogs';
import { MiniCalendar } from '@/components/schedule/mini-calendar';
import { MonthGrid } from '@/components/schedule/month-grid';
import { TimeGrid } from '@/components/schedule/time-grid';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

type Tab = 'calendar' | 'todo';

const VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
];

interface TodoEntry {
  item: TodoItem;
  index: number;
}

/**
 * 日程：左侧迷你月历 + 日历筛选，右侧日 / 周 / 月视图。
 * 数据与分身工具 calendar.create / todo.add 共用同一份 toolData。
 */
export function SchedulePage() {
  const user = useAuthStore((s) => s.user);
  const calendarName = user?.name?.trim() || '我的日历';

  const [tab, setTab] = useState<Tab>('calendar');
  const [view, setView] = useState<CalendarView>('week');
  const [cursor, setCursor] = useState<Dayjs>(() => dayjs());
  const [now, setNow] = useState<Dayjs>(() => dayjs());
  const [miniMonth, setMiniMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const [query, setQuery] = useState('');
  const [showCalendar, setShowCalendar] = useState(true);

  const [calendar, setCalendar] = useState<ScheduleEvent[]>([]);
  const [todo, setTodo] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDate, setCreateDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [createTime, setCreateTime] = useState(() => nextSlotTime(dayjs()));
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<ScheduleEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [todoOpen, setTodoOpen] = useState(false);
  const [todoText, setTodoText] = useState('');
  const [creatingTodo, setCreatingTodo] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [cal, td] = await Promise.all([adminApi.listCalendar(), adminApi.listTodo()]);
      setCalendar(cal.items.map(normalizeEvent));
      setTodo(td.items);
    } catch (e) {
      toast.error('加载失败', e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 分钟级刷新当前时间红线
  useEffect(() => {
    const timer = window.setInterval(() => setNow(dayjs()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 主视图翻页后，小日历跟随到对应月份
  useEffect(() => {
    setMiniMonth(cursor.startOf('month'));
  }, [cursor]);

  const scheduled = useMemo(
    () => calendar.filter((event) => event.date !== null && event.startMin !== null),
    [calendar],
  );
  const unscheduled = useMemo(
    () => calendar.filter((event) => event.date === null || event.startMin === null),
    [calendar],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visibleEvents = useMemo(() => {
    if (!showCalendar) return [];
    if (!normalizedQuery) return scheduled;
    return scheduled.filter((event) => event.title.toLowerCase().includes(normalizedQuery));
  }, [scheduled, showCalendar, normalizedQuery]);
  const visibleUnscheduled = useMemo(() => {
    if (!normalizedQuery) return unscheduled;
    return unscheduled.filter((event) => event.title.toLowerCase().includes(normalizedQuery));
  }, [unscheduled, normalizedQuery]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const event of visibleEvents) {
      if (!event.date) continue;
      const list = map.get(event.date);
      if (list) list.push(event);
      else map.set(event.date, [event]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
    }
    return map;
  }, [visibleEvents]);

  const eventDates = useMemo(
    () =>
      new Set(
        (showCalendar ? scheduled : [])
          .map((event) => event.date)
          .filter((date): date is string => date !== null),
      ),
    [scheduled, showCalendar],
  );

  const viewDays = useMemo<Dayjs[]>(() => {
    if (view === 'day') return [cursor.startOf('day')];
    if (view === 'week') {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
    }
    return [];
  }, [view, cursor]);

  const title = useMemo(() => viewTitle(view, cursor), [view, cursor]);

  const pendingEntries = useMemo<TodoEntry[]>(
    () => todo.map((item, index) => ({ item, index })).filter((entry) => !entry.item.done),
    [todo],
  );
  const doneEntries = useMemo<TodoEntry[]>(
    () => todo.map((item, index) => ({ item, index })).filter((entry) => entry.item.done),
    [todo],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };

  const goToday = () => setCursor(dayjs());
  const navigate = (direction: -1 | 1) => {
    setCursor((current) => current.add(direction, view));
  };

  const openDay = (day: Dayjs) => {
    setCursor(day);
    setView('day');
  };

  const openCreate = (day?: Dayjs, minute?: number) => {
    const target = day ?? cursor;
    setCreateTitle('');
    setCreateDate(target.format('YYYY-MM-DD'));
    setCreateTime(minute == null ? nextSlotTime(target) : formatMinutes(minute));
    setCreateOpen(true);
  };

  const createAt = (day: Dayjs, minute?: number) => {
    setCursor(day);
    openCreate(day, minute);
  };

  const handlePrimary = () => {
    if (tab === 'todo') {
      setTodoText('');
      setTodoOpen(true);
      return;
    }
    openCreate();
  };

  const createEvent = async () => {
    const title = createTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      await adminApi.createCalendarItem({
        title,
        date: createDate || null,
        time: createTime || '09:00',
      });
      setCreateOpen(false);
      if (createDate) setCursor(dayjs(createDate));
      toast.success(
        '日程已创建',
        createDate ? `${dayjs(createDate).format('M月D日')} ${createTime}` : createTime,
      );
      await load(true);
    } catch (e) {
      toast.error('创建日程失败', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const deleteEvent = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      await adminApi.deleteCalendarItem(detail.index);
      setDetail(null);
      toast.success('日程已删除');
      await load(true);
    } catch (e) {
      toast.error('删除日程失败', e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const changeStatus = async (status: ScheduleEvent['status']) => {
    if (!detail) return;
    setStatusChanging(true);
    try {
      await adminApi.updateCalendarItem(detail.index, { status });
      setDetail({ ...detail, status });
      toast.success(
        status === 'confirmed'
          ? '日程已确认'
          : status === 'cancelled'
            ? '日程已取消'
            : '日程已标记为待批准',
      );
      await load(true);
    } catch (e) {
      toast.error('修改状态失败', e instanceof Error ? e.message : String(e));
    } finally {
      setStatusChanging(false);
    }
  };

  const updateEvent = async (fields: {
    title: string;
    date: string | null;
    time: string;
    attendees: string[];
  }) => {
    if (!editingEvent) return;
    setUpdating(true);
    try {
      await adminApi.updateCalendarItem(editingEvent.index, fields);
      setEditingEvent(null);
      setDetail(null);
      toast.success('日程已更新');
      await load(true);
    } catch (e) {
      toast.error('修改日程失败', e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  };

  const createTodo = async () => {
    const text = todoText.trim();
    if (!text) return;
    setCreatingTodo(true);
    try {
      await adminApi.createTodoItem({ text });
      setTodoOpen(false);
      toast.success('待办已添加');
      await load(true);
    } catch (e) {
      toast.error('添加待办失败', e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingTodo(false);
    }
  };

  const toggleTodo = async (index: number, done: boolean) => {
    setBusyKey(`todo-${index}`);
    try {
      await adminApi.updateTodoItem(index, { done });
      setTodo((prev) => prev.map((item, i) => (i === index ? { ...item, done } : item)));
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-view">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-4 border-b border-line">
        <nav className="flex h-full items-center gap-1">
          {(
            [
              { value: 'calendar', label: '日历' },
              { value: 'todo', label: '待办' },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'relative flex h-full items-center px-3 text-[14px] transition-colors',
                tab === value ? 'font-medium text-ink' : 'text-ink-secondary hover:text-ink',
              )}
            >
              {label}
              {tab === value ? (
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="刷新"
            aria-label="刷新"
            disabled={refreshing || loading}
            onClick={() => void refresh()}
          >
            <RiRefreshLine className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>
          <Button size="sm" onClick={handlePrimary}>
            <RiAddLine className="size-3.5" />
            {tab === 'calendar' ? '创建日程' : '新建待办'}
          </Button>
        </div>
      </header>

      {tab === 'calendar' ? (
        <div className="flex min-h-0 flex-1">
          <aside className="scrollbar-thin hidden w-[248px] shrink-0 flex-col overflow-y-auto border-r border-line px-3 py-3 md:flex">
            <MiniCalendar
              cursor={cursor}
              month={miniMonth}
              eventDates={eventDates}
              onMonthChange={setMiniMonth}
              onSelectDay={openDay}
            />

            <div className="relative mt-3">
              <RiSearchLine className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-quaternary" />
              <Input
                inputSize="sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索日程"
                className="pl-7"
              />
            </div>

            <div className="mt-4">
              <p className="px-2 pb-1 text-[11px] font-medium text-ink-tertiary">我的日历</p>
              <div className="space-y-0.5">
                <button
                  type="button"
                  aria-pressed={showCalendar}
                  onClick={() => setShowCalendar((value) => !value)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-ink-secondary transition-colors hover:bg-surface-veil"
                >
                  <span
                    className={cn(
                      'flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors',
                      showCalendar
                        ? 'border-brand bg-brand text-primary-foreground'
                        : 'border-line-strong',
                    )}
                  >
                    {showCalendar ? <RiCheckLine className="size-2.5" /> : null}
                  </span>
                  <span className="truncate">{calendarName}</span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-quaternary">
                    {scheduled.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('todo')}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-ink-secondary transition-colors hover:bg-surface-veil"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-success text-primary-foreground">
                    <RiCheckLine className="size-2.5" />
                  </span>
                  <span className="truncate">我的任务</span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-quaternary">
                    {pendingEntries.length}
                  </span>
                </button>
              </div>
            </div>

            {visibleUnscheduled.length > 0 ? (
              <div className="mt-4">
                <p className="px-2 pb-1 text-[11px] font-medium text-ink-tertiary">
                  未安排 · {visibleUnscheduled.length}
                </p>
                <div className="space-y-0.5">
                  {visibleUnscheduled.map((event) => (
                    <button
                      key={event.key}
                      type="button"
                      onClick={() => setDetail(event)}
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-ink-secondary transition-colors hover:bg-surface-veil"
                    >
                      <RiTimeLine className="size-3.5 shrink-0 text-ink-quaternary" />
                      <span className="truncate">{event.title}</span>
                      <span className="ml-auto max-w-16 shrink-0 truncate text-[10px] tabular-nums text-ink-quaternary">
                        {event.rawTime}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <p className="mt-auto pt-5 text-[11px] leading-relaxed text-ink-quaternary">
              分身与日历共享同一份数据，日程到点会主动提醒。
            </p>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-4">
              <div className="flex min-w-0 items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={goToday}>
                  今天
                </Button>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="上一页"
                    onClick={() => navigate(-1)}
                  >
                    <RiArrowLeftSLine className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="下一页"
                    onClick={() => navigate(1)}
                  >
                    <RiArrowRightSLine className="size-4" />
                  </Button>
                </div>
                <h2 className="ml-1 truncate text-[15px] font-semibold tabular-nums tracking-[-0.012em]">
                  {title}
                </h2>
              </div>

              <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-surface-veil p-0.5">
                {VIEW_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setView(value)}
                    className={cn(
                      'h-7 rounded-sm px-3 text-[12px] transition-colors',
                      view === value
                        ? 'bg-brand-soft font-medium text-brand'
                        : 'text-ink-secondary hover:text-ink',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col border-t border-line">
              {loading ? (
                <CalendarSkeleton />
              ) : view === 'month' ? (
                <MonthGrid
                  month={cursor}
                  now={now}
                  eventsByDay={eventsByDay}
                  onSelectDay={openDay}
                  onSelectEvent={setDetail}
                  onCreateAt={(day) => createAt(day)}
                />
              ) : (
                <TimeGrid
                  days={viewDays}
                  eventsByDay={eventsByDay}
                  now={now}
                  onSelectEvent={setDetail}
                  onCreateAt={createAt}
                />
              )}
            </div>
          </section>
        </div>
      ) : (
        <TodoPane
          loading={loading}
          pending={pendingEntries}
          done={doneEntries}
          busyKey={busyKey}
          onToggle={toggleTodo}
          onRemove={removeTodo}
        />
      )}

      <CreateEventDialog
        open={createOpen}
        title={createTitle}
        date={createDate}
        time={createTime}
        calendarName={calendarName}
        saving={creating}
        onTitleChange={setCreateTitle}
        onDateChange={setCreateDate}
        onTimeChange={setCreateTime}
        onClose={() => setCreateOpen(false)}
        onSubmit={() => void createEvent()}
      />

      <EventDetailDialog
        event={detail}
        calendarName={calendarName}
        deleting={deleting}
        statusChanging={statusChanging}
        onClose={() => setDetail(null)}
        onDelete={() => void deleteEvent()}
        onEdit={() => {
          setEditingEvent(detail);
          setDetail(null);
        }}
        onStatusChange={(status) => void changeStatus(status)}
      />

      <EditEventDialog
        event={editingEvent}
        updating={updating}
        onClose={() => setEditingEvent(null)}
        onSave={(fields) => void updateEvent(fields)}
      />

      <Dialog open={todoOpen} onOpenChange={(value) => !value && setTodoOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建待办</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={todoText}
            onChange={(event) => setTodoText(event.target.value)}
            placeholder="待办内容，如「回复 Bob 的邮件」"
            maxLength={200}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !creatingTodo) {
                event.preventDefault();
                void createTodo();
              }
            }}
          />
          <DialogFooter>
            <Button onClick={() => void createTodo()} disabled={creatingTodo || !todoText.trim()}>
              {creatingTodo ? <RiLoader4Line className="size-4 animate-spin" /> : null}
              创建
            </Button>
            <Button variant="ghost" onClick={() => setTodoOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-16 rounded-md" />
        ))}
      </div>
      <Skeleton className="min-h-0 flex-1 rounded-lg" />
    </div>
  );
}

interface TodoPaneProps {
  loading: boolean;
  pending: TodoEntry[];
  done: TodoEntry[];
  busyKey: string | null;
  onToggle: (index: number, done: boolean) => void;
  onRemove: (index: number) => void;
}

function TodoPane({ loading, pending, done, busyKey, onToggle, onRemove }: TodoPaneProps) {
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-8 py-6">
        <Skeleton className="mb-4 h-6 w-24 rounded-md" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (pending.length === 0 && done.length === 0) {
    return (
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex h-full max-w-2xl flex-col gap-5">
          <TodoHeading pending={0} done={0} />
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-line py-20 text-center">
            <RiInboxLine className="mb-2 size-6 text-ink-quaternary" />
            <p className="text-[13px] text-ink-secondary">还没有待办</p>
            <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-ink-tertiary">
              点右上角「新建待办」，或对分身说「加个待办：回复 Bob 的邮件」。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <TodoHeading pending={pending.length} done={done.length} />
        {pending.length > 0 ? (
          <TodoGroup
            title="未完成"
            entries={pending}
            busyKey={busyKey}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        ) : null}
        {done.length > 0 ? (
          <TodoGroup
            title="已完成"
            entries={done}
            busyKey={busyKey}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        ) : null}
      </div>
    </div>
  );
}

function TodoHeading({ pending, done }: { pending: number; done: number }) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold tracking-[-0.012em]">待办</h2>
      <p className="mt-0.5 text-[12px] text-ink-tertiary">
        {pending} 项待完成 · {done} 项已完成
      </p>
    </div>
  );
}

interface TodoGroupProps {
  title: string;
  entries: TodoEntry[];
  busyKey: string | null;
  onToggle: (index: number, done: boolean) => void;
  onRemove: (index: number) => void;
}

function TodoGroup({ title, entries, busyKey, onToggle, onRemove }: TodoGroupProps) {
  return (
    <section>
      <p className="mb-1.5 px-2 text-[11px] font-medium text-ink-tertiary">
        {title} · {entries.length}
      </p>
      <div className="overflow-hidden rounded-lg border border-line">
        {entries.map(({ item, index }) => (
          <div
            key={`${index}-${item.text}`}
            className="group flex items-center gap-3 border-b border-line/60 px-3 py-2.5 last:border-b-0"
          >
            <button
              type="button"
              disabled={busyKey !== null}
              aria-label={item.done ? '标记为未完成' : '标记为已完成'}
              aria-pressed={item.done}
              onClick={() => onToggle(index, !item.done)}
              className={cn(
                'shrink-0 transition-colors disabled:opacity-50',
                item.done ? 'text-success' : 'text-ink-quaternary hover:text-success',
              )}
            >
              {item.done ? (
                <RiCheckboxCircleFill className="size-5" />
              ) : (
                <RiCheckboxBlankCircleLine className="size-5" />
              )}
            </button>
            <span
              className={cn(
                'min-w-0 flex-1 text-[13px] break-words',
                item.done && 'text-ink-tertiary line-through',
              )}
            >
              {item.text}
            </span>
            <button
              type="button"
              disabled={busyKey !== null}
              aria-label="删除待办"
              title="删除待办"
              onClick={() => onRemove(index)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-quaternary opacity-0 transition-colors hover:bg-surface-hover hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none"
            >
              {busyKey === `todo-${index}` ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiDeleteBinLine className="size-3.5" />
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
