/**
 * 容器原语：Screen / PageHeader / Card / Divider。
 */
import type { ReactNode } from 'react';
import {
  type RefreshControl,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { IconButton } from './button';
import { Text } from './text';

/** 页面根容器：统一背景色；scroll 模式自带键盘处理与底部留白。 */
export function Screen({
  children,
  scroll = false,
  padded = false,
  style,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<typeof RefreshControl>;
}) {
  const t = useTheme();
  const base: ViewStyle = { flex: 1, backgroundColor: t.bg };
  if (!scroll) {
    return <View style={[base, padded && { padding: 16 }, style]}>{children}</View>;
  }
  return (
    <ScrollView
      style={[base, style]}
      contentContainerStyle={{ paddingBottom: 40, ...(padded ? { padding: 16 } : {}) }}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

/** 页头：标题 + 副标题 + 右侧操作，自动处理状态栏安全区；onBack 时左侧显示返回按钮。 */
export function PageHeader({
  title,
  subtitle,
  right,
  onBack,
  large = false,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
  large?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + (large ? 10 : 6),
        paddingHorizontal: onBack ? 8 : 16,
        paddingBottom: large ? 10 : 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {onBack ? <IconButton icon="arrow-left-s-line" label="返回" onPress={onBack} /> : null}
      <View style={{ flex: 1 }}>
        <Text variant={large ? 'h1' : 'title'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            variant="caption"
            tone="muted"
            style={{ marginTop: large ? 2 : 1 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** 表面卡片：统一边框、圆角、内边距；tone 用于告警/危险强调。 */
export function Card({
  children,
  style,
  padding = 14,
  tone = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: tone === 'warning' ? t.warning : tone === 'danger' ? t.danger : t.border,
          padding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.border }, style]} />;
}

/** 表单分组内的间距（替代页面里散落的 marginTop/gap 数字）。 */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
