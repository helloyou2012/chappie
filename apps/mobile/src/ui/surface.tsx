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
  background = 'canvas',
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<typeof RefreshControl>;
  /** canvas：灰色画布；card：白底列表页 */
  background?: 'canvas' | 'card';
}) {
  const t = useTheme();
  const base: ViewStyle = { flex: 1, backgroundColor: background === 'card' ? t.card : t.bg };
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

/**
 * 顶层页头：大标题 + 副标题 + 右侧操作，自动处理状态栏安全区。
 * 传 avatar 时左侧显示账户头像（飞书式大标题页）；二级页优先用 <NavBar>。
 */
export function PageHeader({
  title,
  subtitle,
  right,
  onBack,
  large = false,
  avatar,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
  large?: boolean;
  /** 左侧账户头像（大标题页） */
  avatar?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + (large ? 12 : 6),
        paddingHorizontal: onBack ? 8 : 16,
        paddingBottom: large ? 12 : 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: large ? 12 : 10,
      }}
    >
      {onBack ? <IconButton icon="arrow-left-s-line" label="返回" onPress={onBack} /> : null}
      {avatar}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant={large ? 'h1' : 'title'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 1 }} numberOfLines={1}>
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
