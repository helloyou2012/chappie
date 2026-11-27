import { adminApi, type CalendarItem, dayjs, type TodoItem, useAuthStore } from '@chappie/shared';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, type ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarGrid } from '@/components/schedule/calendar-grid';
import { CalendarRow } from '@/components/schedule/calendar-row';
import { CreateSheet } from '@/components/schedule/create-sheet';
import { EventSheet, type EventTarget } from '@/components/schedule/event-sheet';
import { type ScheduleTab as Tab, topOf } from '@/components/schedule/meta';
import { TodoRow } from '@/components/schedule/todo-row';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, EmptyState, Fab, IconButton, PageHeader, SegmentedControl, Spinner } from '@/ui';

type CalendarView = 'grid' | 'list';

export default function ScheduleScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>('calendar');
  const [view, setView] = useState<CalendarView>('grid');
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [todo, setTodo] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState<Tab | null>(null);
  const [creating, setCreating] = useState(false);
  const [eventEditing, setEventEditing] = useState(false);
  const [calTitle, setCalTitle] = useState('');
  const [calDate, setCalDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [calTime, setCalTime] = useState('10:00');
  const [calAttendees, setCalAttendees] = useState('');
  const [todoText, setTodoText] = useState('');

  const [eventTarget, setEventTarget] = useState<EventTarget | null>(null);
  const gridRef = useRef<ComponentRef<typeof ScrollView>>(null);

  const load = useCallback(async () => {
    try {
      const [cal, td] = await Promise.all([adminApi.listCalendar(), adminApi.listTodo()]);
      setCalendar(cal.items);
      setTodo(td.items);
    } catch {
      // 分身未就绪（409）时保持空列表，下拉可重试
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 每日/每次进入日历视图都滚到当前时间附近
  useEffect(() => {
    if (tab !== 'calendar' || view !== 'grid') return;
    const timer = setTimeout(() => {
      const now = dayjs();
      const minutes = now.hour() * 60 + now.minute();
      gridRef.current?.scrollTo({ y: Math.max(0, topOf(minutes) - 120), animated: false });
    }, 40);
    return () => clearTimeout(timer);
  }, [tab, view]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const removeCalendar = async (index: number) => {
    setBusyKey(`cal-${index}`);
    setEventTarget(null);
    try {
      await adminApi.deleteCalendarItem(index);
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const setCalendarStatus = async (
    index: number,
    status: 'pending' | 'confirmed' | 'cancelled',
  ) => {
    setBusyKey(`cal-${index}`);
    setEventTarget(null);
    try {
      await adminApi.updateCalendarItem(index, { status });
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const toggleTodo = async (index: number, done: boolean) => {
    setBusyKey(`todo-${index}`);
    try {
      await adminApi.updateTodoItem(index, { done });
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const removeTodo = async (index: number) => {
    setBusyKey(`todo-${index}`);
    try {
      await adminApi.deleteTodoItem(index);
      await load();
    } finally {
      setBusyKey(null);
    }
  };

  const openCreate = (kind: Tab) => {
    setCreateOpen(kind);
    if (kind === 'calendar') {
      setCalTitle('');
      setCalDate(dayjs().format('YYYY-MM-DD'));
      setCalTime('10:00');
      setCalAttendees('');
    } else {
      setTodoText('');
    }
  };

  const startEdit = () => {
    if (!eventTarget) return;
    setCalTitle(eventTarget.item.title);
    setCalDate(eventTarget.item.date ?? '');
    setCalTime(eventTarget.item.time);
    setCalAttendees((eventTarget.item.attendees ?? []).join('，'));
    setEventEditing(true);
  };

  const eventFields = () => ({
    title: calTitle.trim(),
    date: calDate.trim() || null,
    time: calTime.trim() || '10:00',
    attendees: calAttendees
      .split(/[,，、]/)
      .map((x) => x.trim())
      .filter(Boolean),
  });

  const saveEventEdit = async () => {
    if (!eventTarget) return;
    const fields = eventFields();
    if (!fields.title) return;
    setCreating(true);
    try {
      await adminApi.updateCalendarItem(eventTarget.index, fields);
      await load();
      setEventEditing(false);
      setEventTarget(null);
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const create = async () => {
    if (!createOpen) return;
    setCreating(true);
    try {
      if (createOpen === 'calendar') {
        if (!calTitle.trim()) return;
        await adminApi.createCalendarItem(eventFields());
      } else {
        if (!todoText.trim()) return;
        await adminApi.createTodoItem({ text: todoText.trim() });
      }
      setCreateOpen(null);
      await load();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const days = [-1, 0, 1].map((d) => dayjs().add(d, 'day'));
  const dayKeys = days.map((d) => d.format('YYYY-MM-DD'));
  const todayKey = dayjs().format('YYYY-MM-DD');
  const now = dayjs();
  const nowMinutes = now.hour() * 60 + now.minute();
  const pendingTodo = todo.filter((x) => !x.done).length;
  const todayCount = calendar.filter((c) => c.date === todayKey).length;

  const eventsForDay = useCallback(
    (key: string) =>
      calendar
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if ((item.date ?? todayKey) !== key) return false;
          return /^\d{1,2}:\d{2}$/.test(item.time);
        }),
    [calendar, todayKey],
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <PageHeader
        large
        avatar={<Avatar name={user?.name ?? '我'} size={44} />}
        title="日程"
        subtitle={`${dayjs().format('YYYY年M月')} · 今天 ${todayCount} 项`}
        right={
          <IconButton
            icon="refresh-line"
            label="刷新日程"
            size={38}
            tone="muted"
            onPress={() => void refresh()}
          />
        }
      />

      <SegmentedControl
        variant="underline"
        options={[
          { value: 'calendar', label: `日程` },
          { value: 'todo', label: `待办 ${pendingTodo}` },
        ]}
        value={tab}
        onChange={setTab}
        trailing={
          tab === 'calendar' ? (
            <IconButton
              icon={view === 'grid' ? 'list-unordered' : 'calendar-line'}
              label={view === 'grid' ? '切换到列表' : '切换到日历'}
              size={34}
              tone="muted"
              onPress={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}
            />
          ) : undefined
        }
      />

      {loading ? (
        <Spinner />
      ) : tab === 'calendar' ? (
        view === 'grid' ? (
          <CalendarGrid
            days={days}
            dayKeys={dayKeys}
            todayKey={todayKey}
            nowMinutes={nowMinutes}
            eventsForDay={eventsForDay}
            gridRef={gridRef}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            onEvent={(item, index) => {
              setEventEditing(false);
              setEventTarget({ item, index });
            }}
          />
        ) : (
          <FlatList
            data={calendar}
            style={{ flex: 1 }}
            keyExtractor={(item, index) => item.id ?? `cal-${index}`}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: insets.bottom + 96,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void refresh()}
                tintColor={t.primary}
              />
            }
            ItemSeparatorComponent={() => (
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.separator }} />
            )}
            renderItem={({ item, index }) => (
              <CalendarRow
                item={item}
                onPress={() => {
                  setEventEditing(false);
                  setEventTarget({ item, index });
                }}
              />
            )}
            ListEmptyComponent={
              <EmptyState
                icon="calendar-2-line"
                title="还没有日程"
                description="点右下角 + 新建，或直接对分身说「明天 10 点产品评审」"
              />
            }
          />
        )
      ) : (
        <FlatList
          data={todo.map((item, index) => ({ item, index }))}
          style={{ flex: 1 }}
          keyExtractor={({ item, index }) => `${item.text}-${index}`}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={t.primary}
            />
          }
          ItemSeparatorComponent={() => (
            <View
              style={{
                height: StyleSheet.hairlineWidth,
                backgroundColor: t.separator,
                marginLeft: 16,
              }}
            />
          )}
          renderItem={({ item: { item: td, index } }) => (
            <TodoRow
              todo={td}
              disabled={busyKey !== null}
              onToggle={() => void toggleTodo(index, !td.done)}
              onDelete={() => void removeTodo(index)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="checkbox-circle-line"
              title="待办清单是空的"
              description="点右下角 + 新建，或对它说「加个待办：回复 Bob 的邮件」"
            />
          }
        />
      )}

      <Fab
        label={tab === 'calendar' ? '新建日程' : '新建待办'}
        onPress={() => openCreate(tab)}
        bottom={20}
      />

      <CreateSheet
        kind={createOpen}
        onClose={() => setCreateOpen(null)}
        creating={creating}
        onCreate={() => void create()}
        calTitle={calTitle}
        setCalTitle={setCalTitle}
        calDate={calDate}
        setCalDate={setCalDate}
        calTime={calTime}
        setCalTime={setCalTime}
        calAttendees={calAttendees}
        setCalAttendees={setCalAttendees}
        todoText={todoText}
        setTodoText={setTodoText}
      />

      <EventSheet
        visible={eventTarget !== null}
        onClose={() => {
          setEventTarget(null);
          setEventEditing(false);
        }}
        target={eventTarget}
        editing={eventEditing}
        saving={creating}
        title={calTitle}
        date={calDate}
        time={calTime}
        attendees={calAttendees}
        setTitle={setCalTitle}
        setDate={setCalDate}
        setTime={setCalTime}
        setAttendees={setCalAttendees}
        onStartEdit={startEdit}
        onCancelEdit={() => setEventEditing(false)}
        onSave={() => void saveEventEdit()}
        onChangeStatus={(status) => {
          if (eventTarget) void setCalendarStatus(eventTarget.index, status);
        }}
        onDelete={() => {
          if (eventTarget) void removeCalendar(eventTarget.index);
        }}
        busy={busyKey !== null}
      />
    </View>
  );
}
