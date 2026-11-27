/**
 * 搜索框：灰色圆角输入 + 放大镜（微信 / 飞书顶部搜索）。
 * 与 Input 不同，它没有描边，用于嵌入导航栏下方或列表顶部。
 */
import { Pressable, TextInput, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export function SearchField({
  value,
  onChangeText,
  placeholder = '搜索',
  onCancel,
  autoFocus = false,
  onSubmit,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** 提供后右侧显示「取消」，用于搜索态的退出 */
  onCancel?: () => void;
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View
        style={{
          flex: 1,
          height: 36,
          borderRadius: 8,
          backgroundColor: t.surfaceRaised,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
        }}
      >
        <Icon name="search-line" size={16} color={t.textTertiary} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.textTertiary}
          autoFocus={autoFocus}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          style={{
            flex: 1,
            fontSize: 15,
            color: t.text,
            paddingVertical: 0,
            height: 36,
          }}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除搜索"
            hitSlop={8}
            onPress={() => onChangeText('')}
          >
            <Icon name="close-circle-fill" size={16} color={t.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      {onCancel ? (
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
          <Text variant="body" tone="primary">
            取消
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
