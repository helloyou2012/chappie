/**
 * 分组列表：白底分块 + 发丝线，参照微信 / 飞书的「设置」与「通讯录」形态。
 *
 * Group 负责分组标题、白底容器和行间发丝线；GroupRow 负责单行内容。
 * 页面用灰色画布（bg）留出 8px 分组间距，不要给分组加圆角或卡片阴影。
 */
import { Children, type ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export function Group({
  title,
  footer,
  children,
  dividerInset = 16,
  style,
}: {
  /** 分组标题（灰色小字，可省略） */
  title?: string;
  /** 分组脚注 */
  footer?: string;
  children: ReactNode;
  /** 行间发丝线左侧缩进：有头像的行用 72–78，有图标块的用 56 */
  dividerInset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {title ? (
        <Text
          variant="caption"
          tone="muted"
          style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 7 }}
        >
          {title}
        </Text>
      ) : null}
      <View style={{ backgroundColor: t.card }}>
        {items.map((child, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 分组内子节点顺序固定，索引即稳定标识
          <View key={index}>
            {index > 0 ? (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: t.separator,
                  marginLeft: dividerInset,
                }}
              />
            ) : null}
            {child}
          </View>
        ))}
      </View>
      {footer ? (
        <Text variant="micro" tone="tertiary" style={{ paddingHorizontal: 16, paddingTop: 6 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** 通讯录分组头（A / B / 我的企业…）：灰色通栏。 */
export function SectionHeader({ title }: { title: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.bg, paddingHorizontal: 16, paddingVertical: 5 }}>
      <Text variant="caption" tone="muted" style={{ fontWeight: '600' }}>
        {title}
      </Text>
    </View>
  );
}

export function GroupRow({
  leading,
  title,
  titleTrailing,
  subtitle,
  value,
  trailing,
  onPress,
  chevron,
  danger = false,
  height,
  accessibilityLabel,
  disabled = false,
}: {
  leading?: ReactNode;
  title: string;
  /** 标题后的行内元素（徽章等） */
  titleTrailing?: ReactNode;
  subtitle?: string;
  /** 右侧次要值（如「跟随系统」） */
  value?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  /** 默认：可点击时显示右箭头；列表行可显式关闭 */
  chevron?: boolean;
  danger?: boolean;
  /** 行最小高度，默认 54（有副标题时 62） */
  height?: number;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  const showChevron = chevron ?? Boolean(onPress);
  const body = (
    <>
      {leading ? <View style={{ alignItems: 'center' }}>{leading}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text
            variant="row"
            numberOfLines={1}
            style={{ flexShrink: 1, color: danger ? t.danger : t.text }}
          >
            {title}
          </Text>
          {titleTrailing}
        </View>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="bodySm" tone="muted" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {showChevron ? <Icon name="arrow-right-s-line" size={18} color={t.textTertiary} /> : null}
    </>
  );

  const base: ViewStyle = {
    minHeight: height ?? (subtitle ? 62 : 54),
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  };

  if (!onPress) return <View style={base}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [base, { backgroundColor: pressed ? t.surfaceHover : 'transparent' }]}
    >
      {body}
    </Pressable>
  );
}
