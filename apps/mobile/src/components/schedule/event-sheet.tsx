import type { CalendarItem } from '@chappie/shared';
import { Alert, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Badge, BottomSheet, Button, Field, Input, Text } from '@/ui';
import { STATUS_META } from './meta';

export type EventTarget = { item: CalendarItem; index: number };

/** 日程详情 / 编辑：同一个抽屉内切换，避免多个 Modal 叠加。 */
export function EventSheet({
  visible,
  onClose,
  target,
  editing,
  saving,
  title,
  date,
  time,
  attendees,
  setTitle,
  setDate,
  setTime,
  setAttendees,
  onStartEdit,
  onCancelEdit,
  onSave,
  onChangeStatus,
  onDelete,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  target: EventTarget | null;
  editing: boolean;
  saving: boolean;
  title: string;
  date: string;
  time: string;
  attendees: string;
  setTitle: (v: string) => void;
  setDate: (v: string) => void;
  setTime: (v: string) => void;
  setAttendees: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onChangeStatus: (status: 'pending' | 'confirmed' | 'cancelled') => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const t = useTheme();
  const status = target ? (STATUS_META[target.item.status ?? 'confirmed'] ?? null) : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={editing ? '编辑日程' : (target?.item.title ?? '日程')}
      description={
        !editing && target
          ? `${target.item.date ?? '今天'} ${target.item.time} · ${status?.label ?? ''}`
          : undefined
      }
      scroll
    >
      {target && editing ? (
        <View>
          <Field label="标题">
            <Input
              value={title}
              onChangeText={setTitle}
              placeholder="如：产品评审会"
              maxLength={100}
            />
          </Field>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label="日期" style={{ flex: 1 }}>
              <Input
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
              />
            </Field>
            <Field label="时间" style={{ flex: 1 }}>
              <Input
                value={time}
                onChangeText={setTime}
                placeholder="HH:mm"
                autoCapitalize="none"
              />
            </Field>
          </View>
          <Field label="相关人">
            <Input
              value={attendees}
              onChangeText={setAttendees}
              placeholder="用逗号分隔，如：Bob，小王"
            />
          </Field>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Button
              label={saving ? '保存中…' : '保存修改'}
              loading={saving}
              disabled={!title.trim()}
              onPress={onSave}
              style={{ flex: 1 }}
            />
            <Button
              label="取消"
              variant="ghost"
              fullWidth={false}
              disabled={saving}
              onPress={onCancelEdit}
            />
          </View>
        </View>
      ) : target ? (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="time-line" size={18} color={t.textMuted} />
            <Text variant="body" tone="muted">
              {target.item.time}
            </Text>
            <Badge label={status?.label ?? '已确认'} tone={status?.tone ?? 'success'} />
          </View>
          {target.item.attendees && target.item.attendees.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Icon name="group-line" size={18} color={t.textMuted} />
              <Text variant="body" tone="muted" style={{ flex: 1 }}>
                {target.item.attendees.join('、')}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Button
              size="sm"
              variant="outline"
              label="编辑"
              icon="edit-line"
              onPress={onStartEdit}
              style={{ flex: 1 }}
            />
            <Button
              size="sm"
              label={
                target.item.status === 'pending'
                  ? '确认'
                  : target.item.status === 'confirmed'
                    ? '取消'
                    : '恢复'
              }
              disabled={busy}
              onPress={() =>
                onChangeStatus(
                  target.item.status === 'pending'
                    ? 'confirmed'
                    : target.item.status === 'confirmed'
                      ? 'cancelled'
                      : 'confirmed',
                )
              }
              style={{ flex: 1 }}
            />
          </View>
          <Button
            size="sm"
            variant="ghost"
            tone="danger"
            label="删除日程"
            disabled={busy}
            onPress={() =>
              Alert.alert('删除日程', '删除后不可恢复。', [
                { text: '取消', style: 'cancel' },
                { text: '删除', style: 'destructive', onPress: onDelete },
              ])
            }
            style={{ marginTop: 6 }}
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}
