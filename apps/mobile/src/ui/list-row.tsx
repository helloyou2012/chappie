/**
 * 列表行：leading / title / subtitle / trailing / onPress 的组合原语。
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export function ListRow({
  leading,
  title,
  titleTrailing,
  subtitle,
  trailing,
  onPress,
  selected = false,
  accessibilityLabel,
}: {
  leading?: ReactNode;
  title: string;
  /** 标题后的行内元素（类型徽章、静默图标等） */
  titleTrailing?: ReactNode;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="body" style={{ fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
            {title}
          </Text>
          {titleTrailing}
        </View>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );

  if (!onPress) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: 10,
        backgroundColor: selected ? t.surfaceRaised : pressed ? t.surfaceHover : 'transparent',
      })}
    >
      {body}
    </Pressable>
  );
}
