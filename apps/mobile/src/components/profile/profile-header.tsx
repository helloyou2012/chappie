import { useAuthStore } from '@chappie/shared';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, Badge, Text } from '@/ui';

/** 微信「我」式账户头：头像 / 名字 / Chappie ID / 职位部门。 */
export function ProfileHeader({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const metaLine = [user?.jobRole, user?.department].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="编辑个人资料"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingTop: insets.top + 26,
        paddingHorizontal: 20,
        paddingBottom: 22,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        backgroundColor: pressed ? t.surfaceHover : t.card,
      })}
    >
      <Avatar name={user?.name ?? '我'} size={64} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h2" numberOfLines={1}>
          {user?.name ?? '未登录'}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 4 }}>
          Chappie ID：{user?.email ?? '—'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
          {user?.jobRole ? <Badge label={user.jobRole} tone="outline" /> : null}
          {user?.department ? <Badge label={user.department} tone="outline" /> : null}
          {!metaLine ? <Badge label="完善职位与部门" tone="muted" /> : null}
        </View>
      </View>
      <Icon name="arrow-right-s-line" size={18} color={t.textTertiary} />
    </Pressable>
  );
}
