import { ApiError, type Avatar as AvatarProfile, adminApi, useAuthStore } from '@chappie/shared';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { CapabilitiesSection } from '@/components/avatar/capabilities-section';
import { MemorySection } from '@/components/avatar/memory-section';
import { PersonaSection } from '@/components/avatar/persona-section';
import { PolicySection } from '@/components/avatar/policy-section';
import { UsageSection, type UsageSummary } from '@/components/avatar/usage-section';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, Badge, Button, PageHeader, SegmentedControl, Spinner, Text } from '@/ui';

type Section = 'persona' | 'policy' | 'capabilities' | 'memory' | 'usage';

const SECTIONS = [
  { value: 'persona', label: '人设' },
  { value: 'policy', label: '策略' },
  { value: 'capabilities', label: '能力' },
  { value: 'memory', label: '记忆' },
  { value: 'usage', label: '用量' },
] as const;

export default function AvatarScreen() {
  const t = useTheme();
  const user = useAuthStore((s) => s.user);
  const [section, setSection] = useState<Section>('persona');
  const [avatar, setAvatar] = useState<AvatarProfile | null>(null);
  const [usage, setUsage] = useState<UsageSummary>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      try {
        const res = await adminApi.getAvatar();
        if (cancelled) return;
        setAvatar(res.avatar);
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

  return (
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <PageHeader
        large
        avatar={<Avatar name={user?.name ?? '我'} variant="avatar" size={44} />}
        title="我的分身"
        subtitle="策略、能力与记忆都在这里管理"
      />
      {!avatar ? (
        <>
          <Spinner size="large" />
          <Text variant="caption" tone="muted" align="center">
            分身初始化中…
          </Text>
        </>
      ) : (
        <>
          <View style={{ paddingHorizontal: 16 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 10,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: t.aiBubble,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="robot-2-line" size={24} color={t.aiText} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {avatar.name}
                  </Text>
                  <Badge
                    label={avatar.status === 'frozen' ? '已冻结' : '运行中'}
                    tone={avatar.status === 'frozen' ? 'danger' : 'success'}
                  />
                </View>
                <Text variant="micro" tone="muted" style={{ marginTop: 2 }}>
                  你的 AI 分身 · 代你接待与处理事务
                </Text>
              </View>
              <FreezeButton avatar={avatar} onChange={setAvatar} />
            </View>

            <SegmentedControl
              variant="underline"
              options={SECTIONS}
              value={section}
              onChange={setSection}
            />
          </View>

          <View style={{ flex: 1, marginTop: 12 }}>
            {section === 'persona' ? <PersonaSection avatar={avatar} onSaved={setAvatar} /> : null}
            {section === 'policy' ? <PolicySection /> : null}
            {section === 'capabilities' ? <CapabilitiesSection /> : null}
            {section === 'memory' ? <MemorySection /> : null}
            {section === 'usage' ? <UsageSection usage={usage} /> : null}
          </View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 人设 + 风格预览
// ---------------------------------------------------------------------------

function FreezeButton({
  avatar,
  onChange,
}: {
  avatar: AvatarProfile;
  onChange: (a: AvatarProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const frozen = avatar.status !== 'frozen';
      await adminApi.freezeAvatar(frozen);
      onChange({ ...avatar, status: frozen ? 'frozen' : 'active' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="sm"
      variant="outline"
      fullWidth={false}
      label={avatar.status === 'frozen' ? '解冻' : '冻结'}
      loading={busy}
      onPress={() => void toggle()}
    />
  );
}
