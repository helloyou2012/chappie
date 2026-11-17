/**
 * 头像：首字母圆形块；human 用稳定色板，avatar 用 AI 主题色，group 用中性色。
 */

import { avatarColor, avatarForeground } from '@chappie/shared';
import { View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export function Avatar({
  name,
  variant = 'human',
  size = 40,
}: {
  name: string;
  variant?: 'human' | 'avatar' | 'group';
  size?: number;
}) {
  const t = useTheme();
  const initial = (Array.from(name.trim())[0] ?? '?').toUpperCase();
  // 分身与真人共用同一底色与形状；AI 身份由外层角标/“AI 代发”等标志区分。
  const background = variant === 'group' ? t.surfaceRaised : avatarColor(name);
  const color = variant === 'group' ? t.textMuted : avatarForeground(name);
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: size * 0.36,
          fontWeight: '600',
          color: color,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}
