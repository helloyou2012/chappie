/**
 * 选择控件：SegmentedControl（互斥分页/视图切换）与 Chip（表单选项、筛选）。
 */
import { Pressable, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
  variant = 'pill',
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (v: T) => void;
  style?: object;
  /** pill：选项选择（表单/设置）；underline：内容视图切换 */
  variant?: 'pill' | 'underline';
}) {
  const t = useTheme();
  if (variant === 'underline') {
    return (
      <View
        accessibilityRole="tablist"
        style={[{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.border }, style]}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(o.value)}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: 'center',
                borderBottomWidth: 2,
                marginBottom: -1,
                borderBottomColor: active ? t.primary : 'transparent',
              }}
            >
              <Text
                variant="bodySm"
                style={{ fontWeight: '600', color: active ? t.text : t.textMuted }}
                numberOfLines={1}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          flexDirection: 'row',
          backgroundColor: t.card,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.border,
          padding: 3,
        },
        style,
      ]}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 9,
              alignItems: 'center',
              backgroundColor: active ? t.primary : 'transparent',
            }}
          >
            <Text
              variant="bodySm"
              style={{ fontWeight: '600', color: active ? t.primaryFg : t.textMuted }}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 9,
        backgroundColor: active ? t.primary : t.bg,
        borderWidth: 1,
        borderColor: active ? t.primary : t.border,
      }}
    >
      <Text variant="caption" style={{ color: active ? t.primaryFg : t.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          active={o.value === value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}
