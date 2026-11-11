import { useAuthStore } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '@/components/logo';
import { useTheme } from '@/hooks/use-theme';

export default function LoginScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const sendCode = useAuthStore((s) => s.sendCode);
  const login = useAuthStore((s) => s.login);
  const setServerUrl = useAuthStore((s) => s.setServerUrl);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(false);
  const [serverDraft, setServerDraft] = useState(serverUrl);

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
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <View style={{ marginBottom: 14 }}>
            <Logo width={96} />
          </View>
          <Text style={{ fontSize: 26, fontWeight: '700', color: t.text }}>Chappie</Text>
          <Text style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>
            你的 AI 分身，替你在线
          </Text>
        </View>

        <View
          style={{
            backgroundColor: t.card,
            borderRadius: 20,
            padding: 20,
            borderWidth: 1,
            borderColor: t.border,
          }}
        >
          {step === 'email' ? (
            <>
              <Text style={{ fontSize: 13, fontWeight: '600', color: t.text, marginBottom: 8 }}>
                邮箱
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={t.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 15,
                  color: t.text,
                }}
              />
              <Text style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>
                首次登录将自动创建账号与分身。
              </Text>
              {error ? (
                <Text style={{ color: t.danger, fontSize: 12, marginTop: 10 }}>{error}</Text>
              ) : null}
              <Pressable
                onPress={() => void onSendCode()}
                disabled={busy || !email.trim()}
                style={{
                  marginTop: 16,
                  backgroundColor: t.primary,
                  opacity: busy || !email.trim() ? 0.5 : 1,
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                {busy ? (
                  <ActivityIndicator color={t.primaryFg} />
                ) : (
                  <Text style={{ color: t.primaryFg, fontSize: 15, fontWeight: '600' }}>
                    获取验证码
                  </Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={() => setStep('email')}>
                <Text style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
                  ‹ 更换邮箱
                </Text>
              </Pressable>
              <Text style={{ fontSize: 13, fontWeight: '600', color: t.text, marginBottom: 8 }}>
                验证码
              </Text>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 位数字"
                placeholderTextColor={t.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                style={{
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 22,
                  letterSpacing: 10,
                  textAlign: 'center',
                  color: t.text,
                }}
              />
              <Text style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>
                已发送至 {email}
                {devCode ? '（开发模式已回显）' : ''}
              </Text>
              {error ? (
                <Text style={{ color: t.danger, fontSize: 12, marginTop: 10 }}>{error}</Text>
              ) : null}
              <Pressable
                onPress={() => void onLogin()}
                disabled={busy || code.length < 4}
                style={{
                  marginTop: 16,
                  backgroundColor: t.primary,
                  opacity: busy || code.length < 4 ? 0.5 : 1,
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                {busy ? (
                  <ActivityIndicator color={t.primaryFg} />
                ) : (
                  <Text style={{ color: t.primaryFg, fontSize: 15, fontWeight: '600' }}>登录</Text>
                )}
              </Pressable>
              <Pressable onPress={() => void onSendCode()} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 12, color: t.textMuted, textAlign: 'center' }}>
                  重新发送验证码
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <Pressable onPress={() => setShowServer((v) => !v)} style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 12, color: t.textMuted, textAlign: 'center' }}>
            ⚙️ 服务器设置
          </Text>
        </Pressable>
        {showServer ? (
          <View
            style={{
              marginTop: 10,
              backgroundColor: t.card,
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: t.border,
            }}
          >
            <Text style={{ fontSize: 11, color: t.textMuted, marginBottom: 6 }}>
              网关地址（Android 模拟器用 http://10.0.2.2:7100）
            </Text>
            <TextInput
              value={serverDraft}
              onChangeText={setServerDraft}
              autoCapitalize="none"
              style={{
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
                fontSize: 13,
                color: t.text,
              }}
            />
            <Pressable
              onPress={() => {
                void setServerUrl(serverDraft);
                setShowServer(false);
              }}
              style={{
                marginTop: 10,
                backgroundColor: t.primary,
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: t.primaryFg, fontWeight: '600', fontSize: 13 }}>保存</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
