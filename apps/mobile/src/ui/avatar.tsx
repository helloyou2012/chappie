/**
 * 头像：首字母圆形块；human 用稳定色板，avatar 用 AI 主题色，group 用中性色。
 */

import { avatarColor } from '@chappie/shared';
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
  const background =
    variant === 'avatar' ? t.aiBubble : variant === 'group' ? t.surfaceRaised : avatarColor(name);
  const color = variant === 'avatar' ? t.aiText : variant === 'group' ? t.textMuted : '#ffffff';
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: variant === 'avatar' ? size * 0.32 : size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: size * 0.36,
          fontWeight: '600',
          color: variant === 'human' ? '#ffffff' : color,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}
