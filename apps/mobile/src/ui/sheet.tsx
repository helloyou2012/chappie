/**
 * 浮层原语：BottomSheet（底部抽屉）、Dialog（居中对话框）、MenuRow（操作菜单行）。
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import Icon, { type IconName } from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export function BottomSheet({
  visible,
  onClose,
  title,
  description,
  children,
  scroll = false,
  maxHeight = '88%',
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  scroll?: boolean;
  maxHeight?: `${number}%`;
  footer?: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="关闭" />
        <View
          style={{
            backgroundColor: t.card,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: 18,
            paddingBottom: 18 + insets.bottom,
            maxHeight,
          }}
        >
          {title ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: description ? 4 : 10,
                gap: 10,
              }}
            >
              <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
                {title}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
                <Icon name="close-line" size={20} color={t.textMuted} />
              </Pressable>
            </View>
          ) : null}
          {description ? (
            <Text variant="caption" tone="muted" style={{ marginBottom: 10 }}>
              {description}
            </Text>
          ) : null}
          {body}
          {footer}
        </View>
      </View>
    </Modal>
  );
}

export function Dialog({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <View style={{ width: '100%', backgroundColor: t.card, borderRadius: 16, padding: 16 }}>
          <Text variant="subtitle" style={{ marginBottom: 8 }}>
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** 长按 / 更多菜单中的一行操作。 */
export function MenuRow({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  const t = useTheme();
  const color = tone === 'danger' ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 6,
        borderRadius: 10,
        backgroundColor: pressed ? t.surfaceHover : 'transparent',
      })}
    >
      <Icon name={icon} size={18} color={color} />
      <Text variant="subtitle" style={{ color, fontWeight: '400' }}>
        {label}
      </Text>
    </Pressable>
  );
}
