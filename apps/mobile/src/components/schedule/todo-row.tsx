import type { TodoItem } from '@chappie/shared';
import { View } from 'react-native';
import { IconButton, Text } from '@/ui';

/** 待办行：勾选完成 / 删除。 */
export function TodoRow({
  todo,
  disabled,
  onToggle,
  onDelete,
}: {
  todo: TodoItem;
  disabled: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 8,
        minHeight: 54,
      }}
    >
      <IconButton
        icon={todo.done ? 'checkbox-circle-fill' : 'circle-line'}
        label={todo.done ? '标记为未完成' : '标记为已完成'}
        tone={todo.done ? 'primary' : 'muted'}
        size={32}
        disabled={disabled}
        onPress={onToggle}
      />
      <Text
        variant="row"
        tone={todo.done ? 'muted' : 'default'}
        style={{ flex: 1, textDecorationLine: todo.done ? 'line-through' : 'none' }}
      >
        {todo.text}
      </Text>
      <IconButton
        icon="delete-bin-line"
        label={`删除待办 ${todo.text}`}
        tone="danger"
        size={32}
        disabled={disabled}
        onPress={onDelete}
      />
    </View>
  );
}
