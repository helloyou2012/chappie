/**
 * 空态：图标 + 标题 + 说明 + 可选操作。
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Icon, { type IconName } from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export function EmptyState({
  icon = 'inbox-line',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 8 }}>
      <Icon name={icon} size={28} color={t.textMuted} />
      <Text variant="bodySm" tone="muted" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="caption" tone="tertiary" align="center">
          {description}
        </Text>
      ) : null}
      {action}
    </View>
  );
}
