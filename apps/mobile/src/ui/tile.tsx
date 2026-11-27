/**
 * 图标块与悬浮按钮。
 *
 * TileIcon：微信通讯录 / 发现页的彩色图标语言。solid = 实色底白字形（通讯录入口），
 * soft = 淡色底彩色字形（飞书快捷入口）。颜色只从 TILE_COLORS 取，不在页面里写色值。
 */
import { Pressable, View } from 'react-native';
import Icon, { type IconName } from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';

export const TILE_COLORS = {
  orange: '#f5a623',
  green: '#07c160',
  blue: '#2b7cf7',
  indigo: '#5b6cf0',
  purple: '#8b6cf0',
  pink: '#ef4b78',
  red: '#ee4b4b',
  teal: '#10b5a5',
  amber: '#f0b429',
} as const;

export type TileColor = keyof typeof TILE_COLORS;

export function TileIcon({
  name,
  color = 'blue',
  size = 30,
  variant = 'solid',
}: {
  name: IconName;
  color?: TileColor;
  size?: number;
  variant?: 'solid' | 'soft';
}) {
  const c = TILE_COLORS[color];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        backgroundColor: variant === 'solid' ? c : `${c}1f`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon
        name={name}
        size={Math.round(size * 0.58)}
        color={variant === 'solid' ? '#ffffff' : c}
      />
    </View>
  );
}

/** 页面主操作悬浮按钮：圆形品牌色 +，置于右下角。 */
export function Fab({
  onPress,
  label,
  icon = 'add-line',
  bottom = 24,
  right = 20,
  disabled = false,
}: {
  onPress: () => void;
  label: string;
  icon?: IconName;
  bottom?: number;
  right?: number;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        position: 'absolute',
        right,
        bottom,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: t.primary,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      })}
    >
      <Icon name={icon} size={26} color={t.primaryFg} />
    </Pressable>
  );
}
