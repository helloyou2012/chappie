import { APP_VERSION, useAuthStore } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { ProfileHeader } from '@/components/profile/profile-header';
import {
  AppearanceSheet,
  ProfileEditSheet,
  PushSheet,
  ServerSheet,
} from '@/components/profile/settings-sheets';
import { useTheme } from '@/hooks/use-theme';
import { type ThemeMode, useThemeStore } from '@/store/theme';
import { Button, Dialog, Group, GroupRow, Screen, Text, TILE_COLORS } from '@/ui';

const THEME_LABELS: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

export default function ProfileScreen() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const themeMode = useThemeStore((s) => s.mode);

  const [profileOpen, setProfileOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushRegistered, setPushRegistered] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const metaLine = [user?.jobRole, user?.department].filter(Boolean).join(' · ');

  return (
    <Screen scroll background="canvas">
      <ProfileHeader onPress={() => setProfileOpen(true)} />

      <View style={{ height: 8, backgroundColor: t.bg }} />

      <Group dividerInset={56}>
        <GroupRow
          leading={<Icon name="contacts-line" size={22} color={TILE_COLORS.blue} />}
          title="联系人"
          value="备注、分身档位"
          onPress={() => router.push('/contacts')}
        />
        <GroupRow
          leading={<Icon name="file-chart-line" size={22} color={TILE_COLORS.green} />}
          title="分身日报"
          value="今日代发与待决定"
          onPress={() => router.push('/reports')}
        />
        <GroupRow
          leading={<Icon name="robot-2-line" size={22} color={TILE_COLORS.purple} />}
          title="我的分身"
          value="人设、策略与记忆"
          onPress={() => router.navigate('/avatar')}
        />
        <GroupRow
          leading={<Icon name="shield-check-line" size={22} color={TILE_COLORS.orange} />}
          title="审批中心"
          value="高风险操作确认"
          onPress={() => router.navigate('/approvals')}
        />
      </Group>

      <View style={{ height: 8, backgroundColor: t.bg }} />

      <Group title="设置" dividerInset={56}>
        <GroupRow
          leading={<Icon name="user-settings-line" size={22} color={TILE_COLORS.blue} />}
          title="个人资料"
          value={metaLine || '未设置'}
          onPress={() => setProfileOpen(true)}
        />
        <GroupRow
          leading={<Icon name="palette-line" size={22} color={TILE_COLORS.indigo} />}
          title="外观"
          value={THEME_LABELS[themeMode]}
          onPress={() => setAppearanceOpen(true)}
        />
        <GroupRow
          leading={<Icon name="notification-3-line" size={22} color={TILE_COLORS.green} />}
          title="推送通知"
          value={pushRegistered ? '已注册' : undefined}
          onPress={() => setPushOpen(true)}
        />
        <GroupRow
          leading={<Icon name="information-line" size={22} color={TILE_COLORS.orange} />}
          title="关于 Chappie"
          value={`版本 ${APP_VERSION}`}
          chevron={false}
        />
        {__DEV__ ? (
          <GroupRow
            leading={<Icon name="settings-3-line" size={22} color={TILE_COLORS.purple} />}
            title="服务器地址"
            subtitle="仅开发构建可见"
            onPress={() => setServerOpen(true)}
          />
        ) : null}
      </Group>

      <View style={{ height: 8, backgroundColor: t.bg }} />

      <Group dividerInset={16}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="退出登录"
          onPress={() => setLogoutOpen(true)}
          style={({ pressed }) => ({
            height: 52,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? t.surfaceHover : 'transparent',
          })}
        >
          <Text variant="row" style={{ color: t.danger }}>
            退出登录
          </Text>
        </Pressable>
      </Group>

      <Text variant="micro" tone="tertiary" align="center" style={{ paddingVertical: 24 }}>
        Chappie · 你的 AI 分身，替你在线
      </Text>

      <ProfileEditSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <AppearanceSheet visible={appearanceOpen} onClose={() => setAppearanceOpen(false)} />
      <PushSheet
        visible={pushOpen}
        onClose={() => setPushOpen(false)}
        onRegistered={() => setPushRegistered(true)}
      />
      {__DEV__ ? <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} /> : null}

      <Dialog visible={logoutOpen} onClose={() => setLogoutOpen(false)} title="确认退出登录？">
        <Text variant="caption" tone="muted" style={{ marginBottom: 12 }}>
          退出后需要重新登录；本地离线队列中未发送的消息将保留。
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button
            label="退出"
            variant="danger"
            onPress={() => {
              setLogoutOpen(false);
              void logout();
            }}
            style={{ flex: 1 }}
          />
          <Button
            label="取消"
            variant="ghost"
            fullWidth={false}
            onPress={() => setLogoutOpen(false)}
          />
        </View>
      </Dialog>
    </Screen>
  );
}
