import { useAuthStore } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/logo';
import { useTheme } from '@/hooks/use-theme';
import { Button, Card, Field, Input, Text } from '@/ui';

export default function LoginScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const sendCode = useAuthStore((s) => s.sendCode);
  const login = useAuthStore((s) => s.login);
  const setServerUrl = useAuthStore((s) => s.setServerUrl);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const adminUrl = useAuthStore((s) => s.adminUrl);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(false);
  const [serverDraft, setServerDraft] = useState(serverUrl);
  const [adminDraft, setAdminDraft] = useState(adminUrl);

  const onSendCode = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendCode(email.trim());
      setDevCode(res.devCode);
      setStep('code');
      if (res.devCode) setCode(res.devCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  const onLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), code.trim());
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 28,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', marginBottom: 32, gap: 6 }}>
          <Logo width={96} />
          <Text variant="h1" style={{ marginTop: 8 }}>
            Chappie
          </Text>
          <Text variant="caption" tone="muted">
            你的 AI 分身，替你在线
          </Text>
        </View>

        <Card padding={20} style={{ borderRadius: 20 }}>
          {step === 'email' ? (
            <>
              <Field label="邮箱">
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
              <Text variant="micro" tone="muted" style={{ marginTop: 8 }}>
                首次登录将自动创建账号与分身。
              </Text>
              {error ? (
                <Text variant="caption" tone="danger" style={{ marginTop: 10 }}>
                  {error}
                </Text>
              ) : null}
              <Button
                label="获取验证码"
                loading={busy}
                disabled={!email.trim()}
                onPress={() => void onSendCode()}
                style={{ marginTop: 16 }}
              />
            </>
          ) : (
            <>
              <Button
                label="‹ 更换邮箱"
                variant="ghost"
                fullWidth={false}
                onPress={() => setStep('email')}
              />
              <Field label="验证码">
                <Input
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位数字"
                  keyboardType="number-pad"
                  maxLength={6}
                  style={{ fontSize: 22, letterSpacing: 10, textAlign: 'center' }}
                />
              </Field>
              <Text variant="micro" tone="muted" style={{ marginTop: 8 }}>
                已发送至 {email}
                {devCode ? '（开发模式已回显）' : ''}
              </Text>
              {error ? (
                <Text variant="caption" tone="danger" style={{ marginTop: 10 }}>
                  {error}
                </Text>
              ) : null}
              <Button
                label="登录"
                loading={busy}
                disabled={code.length < 4}
                onPress={() => void onLogin()}
                style={{ marginTop: 16 }}
              />
              <Button
                label="重新发送验证码"
                variant="ghost"
                size="sm"
                onPress={() => void onSendCode()}
                style={{ marginTop: 10 }}
              />
            </>
          )}
        </Card>

        {/* 服务器地址仅开发构建可配；生产版本使用构建期默认值 */}
        {__DEV__ ? (
          <>
            <Button
              label="服务器设置（开发）"
              variant="ghost"
              size="sm"
              onPress={() => setShowServer((v) => !v)}
              style={{ marginTop: 14 }}
            />
            {showServer ? (
              <Card padding={14} style={{ marginTop: 10 }}>
                <Field label="网关地址" hint="Android 模拟器用 http://10.0.2.2:7100">
                  <Input value={serverDraft} onChangeText={setServerDraft} autoCapitalize="none" />
                </Field>
                <Field label="控制台地址" hint="分身 / 审批 / 日报 API">
                  <Input value={adminDraft} onChangeText={setAdminDraft} autoCapitalize="none" />
                </Field>
                <Button
                  size="sm"
                  label="保存"
                  onPress={() => {
                    void setServerUrl(serverDraft, adminDraft);
                    setShowServer(false);
                  }}
                  style={{ marginTop: 10 }}
                />
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
