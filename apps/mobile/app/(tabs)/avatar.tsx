import { ApiError, type Avatar, adminApi, type UsageDay } from '@chappie/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';

export default function AvatarScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  const [budget, setBudget] = useState('1');
  const [usage, setUsage] = useState<{
    usage: UsageDay[];
    todayCostUsd: number;
    dailyBudgetUsd: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      try {
        const res = await adminApi.getAvatar();
        if (cancelled) return;
        setAvatar(res.avatar);
        setName(res.avatar.name);
        setPersona(res.avatar.persona);
        setBudget(String(res.avatar.dailyBudgetUsd));
        const u = await adminApi.getUsage(7);
        if (!cancelled) setUsage(u);
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.isAvatarNotReady && attempts < 20) {
          attempts += 1;
          setTimeout(() => void tick(), 1500);
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await adminApi.updateAvatar({
        name: name.trim() || undefined,
        persona: persona.trim(),
        dailyBudgetUsd: Number(budget) > 0 ? Number(budget) : undefined,
      });
      setAvatar(res.avatar);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const freeze = async () => {
    if (!avatar) return;
    const frozen = avatar.status !== 'frozen';
    await adminApi.freezeAvatar(frozen);
    setAvatar({ ...avatar, status: frozen ? 'frozen' : 'active' });
  };

  if (!avatar) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}
      >
        <ActivityIndicator color={t.primary} />
        <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 10 }}>分身初始化中…</Text>
      </View>
    );
  }

  const pct = usage ? Math.min(100, (usage.todayCostUsd / (usage.dailyBudgetUsd || 1)) * 100) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="robot-2-line" size={26} color="#ffffff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: t.text }}>{avatar.name}</Text>
            <Text
              style={{ fontSize: 12, color: avatar.status === 'frozen' ? t.danger : t.success }}
            >
              {avatar.status === 'frozen' ? '已冻结' : '运行中'}
            </Text>
          </View>
          <Pressable
            onPress={() => void freeze()}
            style={{
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text style={{ fontSize: 12, color: t.text }}>
              {avatar.status === 'frozen' ? '解冻' : '冻结'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ padding: 16, gap: 12 }}>
        <View
          style={{
            backgroundColor: t.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.border,
            padding: 14,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.text, marginBottom: 10 }}>
            人设
          </Text>
          <Text style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>名称</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={{
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
              color: t.text,
              marginBottom: 10,
            }}
          />
          <Text style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>人设描述</Text>
          <TextInput
            value={persona}
            onChangeText={setPersona}
            multiline
            style={{
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
              color: t.text,
              minHeight: 100,
              textAlignVertical: 'top',
              marginBottom: 10,
            }}
          />
          <Text style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>
            每日预算（美元）
          </Text>
          <TextInput
            value={budget}
            onChangeText={setBudget}
            keyboardType="decimal-pad"
            style={{
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
              color: t.text,
            }}
          />
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            style={{
              marginTop: 12,
              backgroundColor: t.primary,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: 'center',
              opacity: saving ? 0.5 : 1,
            }}
          >
            <Text style={{ color: t.primaryFg, fontWeight: '600' }}>
              {saving ? '保存中…' : saved ? '已保存 ✓' : '保存人设'}
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            backgroundColor: t.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.border,
            padding: 14,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.text, marginBottom: 8 }}>
            今日用量
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: t.text }}>
              ${(usage?.todayCostUsd ?? 0).toFixed(4)}
            </Text>
            <Text style={{ fontSize: 11, color: t.textMuted }}>
              预算 ${(usage?.dailyBudgetUsd ?? 1).toFixed(2)}
            </Text>
          </View>
          <View
            style={{ height: 6, borderRadius: 3, backgroundColor: t.border, overflow: 'hidden' }}
          >
            <View style={{ width: `${pct}%`, height: 6, backgroundColor: t.primary }} />
          </View>
          <Text style={{ fontSize: 10, color: t.textMuted, marginTop: 6 }}>
            近 7 天 {usage?.usage.reduce((n, u) => n + u.requests, 0) ?? 0} 次请求 ·{' '}
            {usage?.usage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0) ?? 0} tokens
          </Text>
        </View>

        <View style={{ backgroundColor: t.aiBubble, borderRadius: 14, padding: 12 }}>
          <Text style={{ fontSize: 12, lineHeight: 18, color: t.aiText }}>
            策略编辑、能力授权、记忆治理等高级设置请在 Web / 桌面端「分身控制台」中完成。
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
