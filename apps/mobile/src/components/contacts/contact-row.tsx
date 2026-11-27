import { type ContactView, MODE_LABELS, type Policy } from '@chappie/shared';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, Badge, Text } from '@/ui';
import { displayName } from './utils';

/** 通讯录联系人行：头像 / 名字（有备注时附原名）/ 分身档位。 */
export function ContactRow({
  contact,
  policy,
  busy,
  onPress,
}: {
  contact: ContactView;
  policy?: Policy;
  busy: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayName(contact)}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: pressed ? t.surfaceHover : 'transparent',
      })}
    >
      <Avatar name={contact.user.name} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="row" numberOfLines={1}>
          {displayName(contact)}
        </Text>
        {contact.alias ? (
          <Text variant="micro" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
            {contact.user.name}
          </Text>
        ) : null}
      </View>
      {policy ? (
        <Badge label={MODE_LABELS[policy.rule.mode]} tone="ai" />
      ) : busy ? (
        <Text variant="micro" tone="tertiary">
          …
        </Text>
      ) : null}
    </Pressable>
  );
}
