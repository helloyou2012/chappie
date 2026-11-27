/**
 * 二级页导航栏：居中标题 + 左侧返回 + 右侧操作（微信 / 飞书形态）。
 * 顶层 Tab 页使用 `PageHeader large`（大标题 + 头像），不要混用。
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { IconButton } from './button';
import { Text } from './text';

export function NavBar({
  title,
  subtitle,
  onBack,
  left,
  right,
  bordered = true,
  background,
  rightInset = 68,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  left?: ReactNode;
  right?: ReactNode;
  /** 底部分隔发丝线（默认显示） */
  bordered?: boolean;
  /** 覆盖底色，默认卡片白 */
  background?: string;
  /**
   * 标题区右侧预留宽度（px）。右侧操作较宽时按其实际宽度传入，
   * 让长标题提前省略而不是被操作区遮挡；默认 68 与左侧对称，标题居中。
   */
  rightInset?: number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: background ?? t.card,
        borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: t.separator,
      }}
    >
      <View
        style={{
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 6,
        }}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {onBack ? (
            <IconButton icon="arrow-left-s-line" label="返回" size={40} onPress={onBack} />
          ) : null}
          {left}
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 68,
            right: rightInset,
            alignItems: 'center',
          }}
        >
          <Text variant="nav" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="micro" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          {right}
        </View>
      </View>
    </View>
  );
}
