import { useAuthStore } from '@chappie/shared';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { ensurePushRegistered } from '@/push';
import { type ThemeMode, useThemeStore } from '@/store/theme';
import { BottomSheet, Button, Field, Input, SegmentedControl, Text } from '@/ui';

/** 个人资料（职位 / 部门）。 */
export function ProfileEditSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [jobRole, setJobRole] = useState('');
  const [department, setDepartment] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setJobRole(user?.jobRole ?? '');
    setDepartment(user?.department ?? '');
    setNotice(null);
  }, [visible, user?.jobRole, user?.department]);

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await updateProfile({ jobRole: jobRole.trim(), department: department.trim() });
      setNotice('已保存');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="个人资料"
      description="职位和部门用于分身判断群聊里是否需要替主人接话。"
      scroll
    >
      <Field label="职位">
        <Input
          value={jobRole}
          onChangeText={setJobRole}
          placeholder="如：产品经理"
          maxLength={40}
        />
      </Field>
      <Field label="部门">
        <Input
          value={department}
          onChangeText={setDepartment}
          placeholder="如：产品部"
          maxLength={60}
        />
      </Field>
      {notice ? (
        <Text
          variant="micro"
          tone={notice === '已保存' ? 'success' : 'danger'}
          style={{ marginTop: 8 }}
        >
          {notice}
        </Text>
      ) : null}
      <Button
        label="保存资料"
        loading={busy}
        onPress={() => void save()}
        style={{ marginTop: 14 }}
      />
    </BottomSheet>
  );
}

/** 外观：跟随系统 / 浅色 / 深色。 */
export function AppearanceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="外观"
      description="跟随系统或固定浅色 / 深色，设置会保存在本机。"
    >
      <SegmentedControl
        options={[
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ]}
        value={themeMode}
        onChange={(mode) => void setThemeMode(mode as ThemeMode)}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
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
    </BottomSheet>
  );
}

/** 推送通知注册状态。 */
export function PushSheet({
  visible,
  onClose,
  onRegistered,
}: {
  visible: boolean;
  onClose: () => void;
  /** 注册成功时通知页面更新「已注册」状态 */
  onRegistered?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const register = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const ok = await ensurePushRegistered(true);
      setStatus(
        ok
          ? '推送已注册（配置 EXPO_ACCESS_TOKEN 后服务端即可下发）'
          : '未获得推送权限或当前环境不支持',
      );
      if (ok) onRegistered?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="推送通知"
      description="分身审批、转交、日程提醒与日报会在你离线时推送到手机。"
    >
      {status ? (
        <Text variant="caption" tone="success" style={{ marginBottom: 10 }}>
          {status}
        </Text>
      ) : null}
      <Button
        label="重新注册推送"
        variant="outline"
        loading={busy}
        onPress={() => void register()}
      />
    </BottomSheet>
  );
}

/** 服务器地址（仅开发构建）。 */
export function ServerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const adminUrl = useAuthStore((s) => s.adminUrl);
  const setServerUrl = useAuthStore((s) => s.setServerUrl);
  const [serverDraft, setServerDraft] = useState(serverUrl);
  const [adminDraft, setAdminDraft] = useState(adminUrl);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setServerDraft(serverUrl);
    setAdminDraft(adminUrl);
    setSaved(false);
  }, [visible, serverUrl, adminUrl]);

  const save = async () => {
    await setServerUrl(serverDraft.trim(), adminDraft.trim());
    setSaved(true);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="服务器地址"
      description="仅开发调试用：真机需填写电脑局域网 IP。正式版本的服务地址由构建期配置决定。"
      scroll
    >
      <Field label="网关地址" hint="Android 模拟器用 http://10.0.2.2:7100">
        <Input value={serverDraft} onChangeText={setServerDraft} autoCapitalize="none" />
      </Field>
      <Field label="控制台地址" hint="分身 / 审批 / 日报 API">
        <Input value={adminDraft} onChangeText={setAdminDraft} autoCapitalize="none" />
      </Field>
      {saved ? (
        <Text variant="micro" tone="success" style={{ marginTop: 8 }}>
          已保存，重新登录后生效
        </Text>
      ) : null}
      <Button label="保存服务器设置" onPress={() => void save()} style={{ marginTop: 14 }} />
    </BottomSheet>
  );
}
