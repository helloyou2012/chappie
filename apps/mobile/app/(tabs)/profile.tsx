import { APP_VERSION, useAuthStore } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { ensurePushRegistered } from '@/push';
import { type ThemeMode, useThemeStore } from '@/store/theme';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  ListRow,
  PageHeader,
  Screen,
  SegmentedControl,
  Text,
} from '@/ui';

export default function ProfileScreen() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const adminUrl = useAuthStore((s) => s.adminUrl);
  const setServerUrl = useAuthStore((s) => s.setServerUrl);
  const logout = useAuthStore((s) => s.logout);
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);

  const [serverDraft, setServerDraft] = useState(serverUrl);
  const [adminDraft, setAdminDraft] = useState(adminUrl);
  const [serverSaved, setServerSaved] = useState(false);

  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const saveServer = async () => {
    await setServerUrl(serverDraft.trim(), adminDraft.trim());
    setServerSaved(true);
  };

  const registerPush = async () => {
    setPushBusy(true);
    setPushStatus(null);
    try {
      const ok = await ensurePushRegistered(true);
      setPushStatus(
        ok
          ? '推送已注册（配置 EXPO_ACCESS_TOKEN 后服务端即可下发）'
          : '未获得推送权限或当前环境不支持',
      );
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <Screen scroll>
      <PageHeader large title="我的" subtitle="账号、通知与服务器设置" />

      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        {/* 账号 */}
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name={user?.name ?? '我'} size={54} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="h2" numberOfLines={1}>
              {user?.name ?? '未登录'}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          <Badge label="已登录" tone="success" />
        </Card>

        {/* 更多入口 */}
        <Card padding={8}>
          <ListRow
            leading={<Icon name="contacts-line" size={20} color={t.primary} />}
            title="联系人"
            subtitle="备注名、我的分身对 TA 的档位、发起单聊"
            trailing={<Icon name="arrow-right-s-line" size={18} color={t.textMuted} />}
            onPress={() => router.push('/contacts')}
          />
          <View style={{ height: 1, backgroundColor: t.border, marginLeft: 40 }} />
          <ListRow
            leading={<Icon name="file-chart-line" size={20} color={t.primary} />}
            title="分身日报"
            subtitle="今天的代发、任务与待你决定"
            trailing={<Icon name="arrow-right-s-line" size={18} color={t.textMuted} />}
            onPress={() => router.push('/reports')}
          />
          <View style={{ height: 1, backgroundColor: t.border, marginLeft: 40 }} />
          <ListRow
            leading={<Icon name="information-line" size={20} color={t.textMuted} />}
            title="关于 Chappie"
            subtitle={`版本 ${APP_VERSION}`}
          />
        </Card>

        {/* 推送通知 */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="notification-3-line" size={20} color={t.primary} />
            <Text variant="subtitle" style={{ flex: 1 }}>
              推送通知
            </Text>
          </View>
          <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
            分身审批、转交、日程提醒与日报会在你离线时推送到手机。
          </Text>
          {pushStatus ? (
            <Text variant="micro" tone="success" style={{ marginTop: 6 }}>
              {pushStatus}
            </Text>
          ) : null}
          <Button
            label="重新注册推送"
            variant="outline"
            size="sm"
            loading={pushBusy}
            onPress={() => void registerPush()}
            style={{ marginTop: 10 }}
          />
        </Card>

        {/* 外观 */}
        <Card>
          <Text variant="subtitle">外观</Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 2, marginBottom: 10 }}>
            跟随系统或固定浅色 / 深色，设置会保存在本机。
          </Text>
          <SegmentedControl
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
            value={themeMode}
            onChange={(mode) => void setThemeMode(mode as ThemeMode)}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Icon
              name={
                themeMode === 'dark'
                  ? 'moon-line'
                  : themeMode === 'light'
                    ? 'sun-line'
                    : 'contrast-line'
              }
              size={16}
              color={t.textMuted}
            />
            <Text variant="micro" tone="muted">
              {themeMode === 'system'
                ? '当前跟随系统外观'
                : themeMode === 'dark'
                  ? '当前固定深色'
                  : '当前固定浅色'}
            </Text>
          </View>
        </Card>

        {/* 服务器设置（仅开发构建可见）：生产环境地址由构建期固定 */}
        {__DEV__ ? (
          <Card>
            <Text variant="subtitle">开发者选项 · 服务器地址</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              仅开发调试用：真机需填写电脑局域网
              IP。正式版本的服务地址由构建期配置决定，不向用户暴露。
            </Text>
            <Field label="网关地址" hint="Android 模拟器用 http://10.0.2.2:7100">
              <Input value={serverDraft} onChangeText={setServerDraft} autoCapitalize="none" />
            </Field>
            <Field label="控制台地址" hint="分身 / 审批 / 日报 API">
              <Input value={adminDraft} onChangeText={setAdminDraft} autoCapitalize="none" />
            </Field>
            {serverSaved ? (
              <Text variant="micro" tone="success" style={{ marginTop: 6 }}>
                已保存，重新登录后生效
              </Text>
            ) : null}
            <Button
              label="保存服务器设置"
              variant="outline"
              size="sm"
              onPress={() => void saveServer()}
              style={{ marginTop: 10 }}
            />
          </Card>
        ) : null}

        {/* 退出登录 */}
        <Button
          label="退出登录"
          variant="outline"
          tone="danger"
          onPress={() => setLogoutOpen(true)}
        />
        <Text variant="micro" tone="tertiary" align="center">
          Chappie · 你的 AI 分身，替你在线
        </Text>
      </View>

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
