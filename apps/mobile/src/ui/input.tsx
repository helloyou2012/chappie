/**
 * 表单原语：Field（标签 + 说明）、Input（单行/多行文本域）。
 *
 * 高度档位与 Button 对齐：size="md" → 44（默认，触控友好），size="sm" → 34。
 * 同一行里的 Input / Button 必须使用同一档位，不允许混用。
 */
import { type ComponentRef, forwardRef, type ReactNode } from 'react';
import { type StyleProp, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export type InputSize = 'sm' | 'md';

const HEIGHTS: Record<InputSize, number> = { sm: 34, md: 44 };

export function Field({
  label,
  hint,
  children,
  style,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: 4, marginTop: 10 }, style]}>
      {label ? (
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      ) : null}
      {children}
      {hint ? (
        <Text variant="micro" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export const Input = forwardRef<
  ComponentRef<typeof TextInput>,
  TextInputProps & { minHeight?: number; size?: InputSize }
>(function Input({ multiline = false, minHeight, size = 'md', style, ...props }, ref) {
  const t = useTheme();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={t.textMuted}
      multiline={multiline}
      style={[
        {
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 9 : 0,
          color: t.text,
          fontSize: 14,
          backgroundColor: 'transparent',
          height: multiline ? undefined : HEIGHTS[size],
          // 多行默认单行高度（44），由调用方按需给更高的 minHeight
          minHeight: multiline ? (minHeight ?? 44) : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        },
        style,
      ]}
      {...props}
    />
  );
});
