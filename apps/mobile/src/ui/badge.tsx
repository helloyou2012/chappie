/**
 * 徽章：状态/标签的轻量表达（muted / success / warning / danger / ai / outline）。
 */
import { View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Text, type TextTone } from './text';

export type BadgeTone = 'muted' | 'brand' | 'success' | 'warning' | 'danger' | 'ai' | 'outline';

export function Badge({ label, tone = 'muted' }: { label: string; tone?: BadgeTone }) {
  const t = useTheme();
  const bg: Record<BadgeTone, string> = {
    muted: t.surfaceRaised,
    brand: `${t.primary}1a`,
    success: `${t.success}1f`,
    warning: `${t.warning}1f`,
    danger: `${t.danger}1f`,
    ai: t.aiBubble,
    outline: 'transparent',
  };
  const fg: Record<BadgeTone, TextTone> = {
    muted: 'muted',
    brand: 'primary',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    ai: 'ai',
    outline: 'muted',
  };
  return (
    <View
      style={{
        alignSelf: 'center',
        borderRadius: 4,
        paddingHorizontal: 5,
        paddingVertical: 1.5,
        backgroundColor: bg[tone],
        borderWidth: tone === 'outline' ? 1 : 0,
        borderColor: t.border,
      }}
    >
      <Text variant="micro" tone={fg[tone]} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}
