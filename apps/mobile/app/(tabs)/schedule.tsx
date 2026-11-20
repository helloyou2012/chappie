import { adminApi, type CalendarItem, dayjs, type TodoItem } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  SegmentedControl,
  Spinner,
  Text,
} from '@/ui';

type Tab = 'calendar' | 'todo';

const HOUR_HEIGHT = 44;
const START_HOUR = 8;
const END_HOUR = 21;

export default function ScheduleScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('calendar');
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [todo, setTodo] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState<Tab | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [calTitle, setCalTitle] = useState('');
  const [calDate, setCalDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [calTime, setCalTime] = useState('10:00');
  const [calAttendees, setCalAttendees] = useState('');
  const [todoText, setTodoText] = useState('');

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
    setEditingIndex(null);
    if (kind === 'calendar') {
      setCalTitle('');
      setCalDate(dayjs().format('YYYY-MM-DD'));
      setCalTime('10:00');
      setCalAttendees('');
    } else {
      setTodoText('');
    }
  };

  const openEdit = (item: CalendarItem, index: number) => {
    setEditingIndex(index);
    setCreateOpen('calendar');
    setCalTitle(item.title);
    setCalDate(item.date ?? '');
    setCalTime(item.time);
    setCalAttendees((item.attendees ?? []).join('，'));
  };

  const create = async () => {
    if (!createOpen) return;
    setCreating(true);
    try {
      if (createOpen === 'calendar') {
        if (!calTitle.trim()) return;
        const fields = {
          title: calTitle.trim(),
          date: calDate.trim() || null,
          time: calTime.trim() || '10:00',
          attendees: calAttendees
            .split(/[,，、]/)
            .map((x) => x.trim())
            .filter(Boolean),
        };
        if (editingIndex !== null) {
          await adminApi.updateCalendarItem(editingIndex, fields);
        } else {
          await adminApi.createCalendarItem(fields);
        }
      } else {
        if (!todoText.trim()) return;
        await adminApi.createTodoItem({ text: todoText.trim() });
      }
      setCreateOpen(null);
      await load();
    } finally {
      setCreating(false);
    }
  };

  const data = tab === 'calendar' ? calendar : todo;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <PageHeader
        large
        title="日程与待办"
        subtitle="分身与你共享同一份数据；到点会主动提醒"
        right={
          <Button
            size="sm"
            variant="outline"
            fullWidth={false}
            label="刷新"
            onPress={() => void refresh()}
          />
        }
      />

      <View style={{ paddingHorizontal: 16 }}>
        <SegmentedControl
          variant="underline"
          options={[
            { value: 'calendar', label: `日程 ${calendar.length}` },
            { value: 'todo', label: `待办 ${todo.filter((x) => !x.done).length}/${todo.length}` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {loading ? (
        <Spinner />
      ) : (
        <FlatList
          data={data as (CalendarItem | TodoItem)[]}
          keyExtractor={(item, index) =>
            tab === 'calendar'
              ? ((item as CalendarItem).id ?? `cal-${index}`)
              : `${(item as TodoItem).text}-${index}`
          }
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 88, gap: 8 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={t.primary}
            />
          }
          ListHeaderComponent={tab === 'calendar' ? <Timeline items={calendar} /> : undefined}
          renderItem={({ item, index }) => {
            if (tab === 'calendar') {
              const cal = item as CalendarItem;
              const isToday = cal.date ? dayjs(cal.date).isSame(dayjs(), 'day') : false;
              return (
                <Card padding={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: t.aiBubble,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="calendar-line" size={18} color={t.aiText} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body" style={{ fontWeight: '500' }} numberOfLines={1}>
                      {cal.title}
                    </Text>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}
                    >
                      <Text variant="micro" tone="muted">
                        {cal.date ? `${cal.date.slice(5)} ${cal.time}` : cal.time}
                        {isToday ? ' · 今天' : ''}
                      </Text>
                      <Badge
                        label={
                          cal.status === 'pending'
                            ? '待批准'
                            : cal.status === 'cancelled'
                              ? '已取消'
                              : '已确认'
                        }
                        tone={
                          cal.status === 'pending'
                            ? 'warning'
                            : cal.status === 'cancelled'
                              ? 'muted'
                              : 'success'
                        }
                      />
                    </View>
                    {cal.attendees && cal.attendees.length > 0 ? (
                      <Text variant="micro" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
                        相关人：{cal.attendees.join('、')}
                      </Text>
                    ) : null}
                  </View>
                  <IconButton
                    icon="edit-line"
                    label={`编辑日程 ${cal.title}`}
                    size={34}
                    disabled={busyKey !== null}
                    onPress={() => openEdit(cal, index)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    label={
                      cal.status === 'pending'
                        ? '确认'
                        : cal.status === 'confirmed'
                          ? '取消'
                          : '恢复'
                    }
                    disabled={busyKey !== null}
                    onPress={() =>
                      void setCalendarStatus(
                        index,
                        cal.status === 'pending'
                          ? 'confirmed'
                          : cal.status === 'confirmed'
                            ? 'cancelled'
                            : 'confirmed',
                      )
                    }
                  />
                  <IconButton
                    icon="delete-bin-line"
                    label={`删除日程 ${cal.title}`}
                    tone="danger"
                    size={34}
                    disabled={busyKey !== null}
                    onPress={() => void removeCalendar(index)}
                  />
                </Card>
              );
            }
            const td = item as TodoItem;
            return (
              <Card padding={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: `${t.success}1f`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="checkbox-circle-line" size={18} color={t.success} />
                </View>
                <IconButton
                  icon={td.done ? 'checkbox-circle-fill' : 'circle-line'}
                  label={td.done ? '标记为未完成' : '标记为已完成'}
                  tone={td.done ? 'primary' : 'muted'}
                  size={34}
                  disabled={busyKey !== null}
                  onPress={() => void toggleTodo(index, !td.done)}
                />
                <Text
                  variant="body"
                  tone={td.done ? 'muted' : 'default'}
                  style={{ flex: 1, textDecorationLine: td.done ? 'line-through' : 'none' }}
                >
                  {td.text}
                </Text>
                <IconButton
                  icon="delete-bin-line"
                  label={`删除待办 ${td.text}`}
                  tone="danger"
                  size={34}
                  disabled={busyKey !== null}
                  onPress={() => void removeTodo(index)}
                />
              </Card>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-2-line"
              title={tab === 'calendar' ? '还没有日程' : '待办清单是空的'}
              description={
                tab === 'calendar'
                  ? '点右下角 + 新建，或直接对分身说「明天 10 点产品评审」'
                  : '点右下角 + 新建，或对它说「加个待办：回复 Bob 的邮件」'
              }
            />
          }
        />
      )}

      {/* 主操作：新建日程 / 待办 */}
      <Button
        size="sm"
        label={tab === 'calendar' ? '新建日程' : '新建待办'}
        icon="add-line"
        fullWidth={false}
        onPress={() => openCreate(tab)}
        style={{ position: 'absolute', right: 18, bottom: insets.bottom + 18 }}
      />

      {/* 新建表单 */}
      <CreateSheet
        kind={createOpen}
        onClose={() => setCreateOpen(null)}
        creating={creating}
        onCreate={() => void create()}
        editing={editingIndex !== null}
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
    </View>
  );
}

// ---------------------------------------------------------------------------
// 今日时间轴（整点网格 + 当前时刻红线）
// ---------------------------------------------------------------------------

function Timeline({ items }: { items: CalendarItem[] }) {
  const t = useTheme();
  const now = dayjs();
  const todayKey = now.format('YYYY-MM-DD');
  const todays = items.filter((i) => i.date === todayKey && /^\d{1,2}:\d{2}$/.test(i.time));
  const nowMinutes = now.hour() * 60 + now.minute();
  const showNow = nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const topOf = (minutes: number) => ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;

  return (
    <Card padding={0} style={{ overflow: 'hidden', marginBottom: 6 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 6,
        }}
      >
        <Text variant="subtitle">今日时间轴</Text>
        <Text variant="micro" tone="muted">
          {now.format('MM-DD')} · {todays.length} 项
        </Text>
      </View>
      <View style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT + 16, position: 'relative' }}>
        {hours.map((h) => (
          <View
            key={h}
            style={{
              position: 'absolute',
              top: (h - START_HOUR) * HOUR_HEIGHT,
              left: 0,
              right: 0,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text
              variant="micro"
              tone="tertiary"
              style={{ width: 52, textAlign: 'right', paddingRight: 8 }}
            >
              {String(h).padStart(2, '0')}:00
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
          </View>
        ))}

        {todays.map((item) => {
          const [hh, mm] = item.time.split(':').map((x) => Number(x));
          const top = topOf((hh ?? 0) * 60 + (mm ?? 0));
          if (top < 0 || top > (END_HOUR - START_HOUR) * HOUR_HEIGHT) return null;
          return (
            <View
              key={item.id ?? `${item.time}-${item.title}`}
              style={{
                position: 'absolute',
                top,
                left: 60,
                right: 14,
                height: 24,
                borderRadius: 7,
                backgroundColor: t.aiBubble,
                paddingHorizontal: 8,
                justifyContent: 'center',
              }}
            >
              <Text variant="micro" tone="ai" numberOfLines={1}>
                {item.time} {item.title}
              </Text>
            </View>
          );
        })}

        {showNow ? (
          <View
            style={{
              position: 'absolute',
              top: topOf(nowMinutes),
              left: 44,
              right: 0,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.danger }} />
            <View style={{ flex: 1, height: 1.5, backgroundColor: t.danger }} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function CreateSheet({
  kind,
  onClose,
  creating,
  onCreate,
  editing,
  calTitle,
  setCalTitle,
  calDate,
  setCalDate,
  calTime,
  setCalTime,
  calAttendees,
  setCalAttendees,
  todoText,
  setTodoText,
}: {
  kind: Tab | null;
  onClose: () => void;
  creating: boolean;
  onCreate: () => void;
  editing: boolean;
  calTitle: string;
  setCalTitle: (v: string) => void;
  calDate: string;
  setCalDate: (v: string) => void;
  calTime: string;
  setCalTime: (v: string) => void;
  calAttendees: string;
  setCalAttendees: (v: string) => void;
  todoText: string;
  setTodoText: (v: string) => void;
}) {
  return (
    <BottomSheet
      visible={kind !== null}
      onClose={onClose}
      title={kind === 'calendar' ? (editing ? '编辑日程' : '新建日程') : '新建待办'}
    >
      {kind === 'calendar' ? (
        <>
          <Field label="标题">
            <Input
              value={calTitle}
              onChangeText={setCalTitle}
              placeholder="如：产品评审会"
              maxLength={100}
            />
          </Field>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="日期" style={{ flex: 1 }}>
              <Input
                value={calDate}
                onChangeText={setCalDate}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
              />
            </Field>
            <Field label="时间" style={{ flex: 1 }}>
              <Input
                value={calTime}
                onChangeText={setCalTime}
                placeholder="HH:mm"
                autoCapitalize="none"
              />
            </Field>
          </View>
          <Field label="相关人">
            <Input
              value={calAttendees}
              onChangeText={setCalAttendees}
              placeholder="用逗号分隔，如：Bob，小王"
            />
          </Field>
        </>
      ) : (
        <Field label="内容">
          <Input
            value={todoText}
            onChangeText={setTodoText}
            placeholder="如：回复 Bob 的邮件"
            maxLength={200}
          />
        </Field>
      )}
      <Button
        label={creating ? '保存中…' : editing ? '保存修改' : '创建'}
        loading={creating}
        onPress={onCreate}
        style={{ marginTop: 14 }}
      />
    </BottomSheet>
  );
}
