/**
 * 徽章：状态/标签的轻量表达（muted / success / warning / danger / ai / outline）。
 */
import { View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Text, type TextTone } from './text';

export type BadgeTone = 'muted' | 'success' | 'warning' | 'danger' | 'ai' | 'outline';

export function Badge({ label, tone = 'muted' }: { label: string; tone?: BadgeTone }) {
  const t = useTheme();
  const bg: Record<BadgeTone, string> = {
    muted: t.surfaceRaised,
    success: `${t.success}1f`,
    warning: `${t.warning}1f`,
    danger: `${t.danger}1f`,
    ai: t.aiBubble,
    outline: 'transparent',
  };
  const fg: Record<BadgeTone, TextTone> = {
    muted: 'muted',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    ai: 'ai',
    outline: 'muted',
  };
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: bg[tone],
        borderWidth: tone === 'outline' ? 1 : 0,
        borderColor: t.border,
      }}
    >
      <Text variant="micro" tone={fg[tone]}>
        {label}
      </Text>
    </View>
  );
}
