/**
 * 按钮：Button（带文字）/ IconButton（仅图标）。
 * variant 表达层级：primary > secondary > outline > ghost；danger 用于破坏性操作。
 */
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Icon, { type IconName } from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const SIZES: Record<ButtonSize, { height: number; px: number; font: number; radius: number }> = {
  sm: { height: 34, px: 12, font: 13, radius: 9 },
  md: { height: 44, px: 16, font: 15, radius: 11 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  tone = 'default',
  fullWidth = true,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** 文字/描边强调色（outline、ghost 时生效） */
  tone?: 'default' | 'warning' | 'danger';
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = SIZES[size];
  const blocked = disabled || loading;
  const toneColor = tone === 'warning' ? t.warning : tone === 'danger' ? t.danger : t.text;

  const bg =
    variant === 'primary'
      ? t.primary
      : variant === 'secondary'
        ? t.surfaceRaised
        : variant === 'danger'
          ? t.danger
          : 'transparent';
  const fg =
    variant === 'primary'
      ? t.primaryFg
      : variant === 'danger'
        ? '#ffffff'
        : variant === 'outline' || variant === 'ghost'
          ? toneColor
          : t.text;
  const border =
    variant === 'outline' ? (tone === 'default' ? t.border : toneColor) : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [
        {
          height: s.height,
          paddingHorizontal: s.px,
          borderRadius: s.radius,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 6,
          opacity: blocked ? 0.5 : pressed ? 0.85 : 1,
          // 仅撑满时拉伸；非撑满交由父容器对齐（如空态居中），不要强制 flex-start
          ...(fullWidth ? { alignSelf: 'stretch' as const } : null),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={s.font + 3} color={fg} />
      ) : null}
      <Text style={{ fontSize: s.font, fontWeight: '600', color: fg }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  size = 34,
  tone = 'default',
  disabled = false,
  filled = false,
  solid = false,
}: {
  icon: IconName;
  /** 无障碍标签（必填） */
  label: string;
  onPress: () => void;
  size?: number;
  tone?: 'default' | 'primary' | 'danger' | 'muted';
  disabled?: boolean;
  filled?: boolean;
  /** 实心圆钮：tone 色为底、图标反白；禁用时回落为中性灰 */
  solid?: boolean;
}) {
  const t = useTheme();
  const color =
    tone === 'primary'
      ? t.primary
      : tone === 'danger'
        ? t.danger
        : tone === 'muted'
          ? t.textMuted
          : t.text;
  const solidBackground = tone === 'danger' ? t.danger : tone === 'primary' ? t.primary : t.text;
  const solidColor = tone === 'primary' ? t.primaryFg : '#ffffff';
  const background = solid
    ? disabled
      ? t.surfaceHover
      : solidBackground
    : filled
      ? t.surfaceRaised
      : 'transparent';
  const fg = solid ? (disabled ? t.textTertiary : solidColor) : color;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        // 实心钮禁用时已用中性色表达不可用，不再叠加透明度
        opacity: disabled ? (solid ? 1 : 0.4) : pressed ? 0.7 : 1,
        backgroundColor: background,
      })}
    >
      <Icon name={icon} size={Math.round(size * 0.52)} color={fg} />
    </Pressable>
  );
}
