/**
 * AppText —— 移动端排版原语。
 * 语义化 variant + tone，避免页面直接写 fontSize / color。
 */
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export type TextVariant =
  | 'h1'
  | 'h2'
  | 'title'
  | 'subtitle'
  | 'body'
  | 'bodySm'
  | 'caption'
  | 'micro';

export type TextTone =
  | 'default'
  | 'muted'
  | 'tertiary'
  | 'primary'
  | 'onPrimary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'ai'
  | 'agent';

const VARIANTS: Record<TextVariant, TextStyle> = {
  h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 14 },
  bodySm: { fontSize: 13 },
  caption: { fontSize: 12 },
  micro: { fontSize: 10 },
};

export function Text({
  variant = 'body',
  tone = 'default',
  align,
  style,
  ...rest
}: TextProps & { variant?: TextVariant; tone?: TextTone; align?: TextStyle['textAlign'] }) {
  const t = useTheme();
  const color: Record<TextTone, string> = {
    default: t.text,
    muted: t.textMuted,
    tertiary: t.textTertiary,
    primary: t.primary,
    onPrimary: t.primaryFg,
    danger: t.danger,
    success: t.success,
    warning: t.warning,
    ai: t.aiText,
    agent: t.agent,
  };
  return (
    <RNText
      {...rest}
      style={[
        VARIANTS[variant],
        { color: color[tone] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
