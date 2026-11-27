import { View } from 'react-native';
import { BottomSheet, Button, Field, Input } from '@/ui';
import type { ScheduleTab } from './meta';

/** 新建日程 / 待办抽屉（受控表单）。 */
export function CreateSheet({
  kind,
  onClose,
  creating,
  onCreate,
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
  kind: ScheduleTab | null;
  onClose: () => void;
  creating: boolean;
  onCreate: () => void;
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
      title={kind === 'calendar' ? '新建日程' : '新建待办'}
      scroll
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
        label={creating ? '保存中…' : '创建'}
        loading={creating}
        onPress={onCreate}
        style={{ marginTop: 14 }}
      />
    </BottomSheet>
  );
}
