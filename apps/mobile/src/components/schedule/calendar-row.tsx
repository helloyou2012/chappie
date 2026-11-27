import type { CalendarItem } from '@chappie/shared';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Badge, Text } from '@/ui';
import { STATUS_META } from './meta';

/** 列表视图中的日程行：时间 / 标题 / 状态 / 相关人。 */
export function CalendarRow({ item, onPress }: { item: CalendarItem; onPress: () => void }) {
  const t = useTheme();
  const status = STATUS_META[item.status ?? 'confirmed'] ?? {
    label: '已确认',
    tone: 'success' as const,
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} ${item.date ?? '今天'} ${item.time}`}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? t.surfaceHover : 'transparent',
      })}
    >
      <View style={{ width: 52 }}>
        <Text variant="body" style={{ fontWeight: '600' }}>
          {item.time}
        </Text>
        <Text variant="micro" tone="muted" style={{ marginTop: 1 }}>
          {item.date ? item.date.slice(5) : '今天'}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="row" numberOfLines={1} style={{ flexShrink: 1 }}>
            {item.title}
          </Text>
          <Badge label={status.label} tone={status.tone} />
        </View>
        {item.attendees && item.attendees.length > 0 ? (
          <Text variant="micro" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
            {item.attendees.join('、')}
          </Text>
        ) : null}
      </View>
      <Icon name="arrow-right-s-line" size={16} color={t.textTertiary} />
    </Pressable>
  );
}
