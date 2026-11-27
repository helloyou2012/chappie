import { adminApi, MODE_LABELS, type Policy, RISK_LABELS, type RiskLevel } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  ChipRow,
  EmptyState,
  Field,
  Input,
  Spinner,
  Text,
  Toggle,
} from '@/ui';

const SCOPE_OPTIONS = [
  { value: 'global', label: '全局默认' },
  { value: 'contact', label: '联系人' },
  { value: 'contact_group', label: '联系人分组' },
  { value: 'conversation', label: '会话' },
  { value: 'schedule', label: '场景/日程' },
] as const;

const MODE_OPTIONS = [
  { value: 'manual', label: MODE_LABELS.manual },
  { value: 'draft', label: MODE_LABELS.draft },
  { value: 'auto', label: MODE_LABELS.auto },
  { value: 'off', label: MODE_LABELS.off },
] as const;

const RISK_OPTIONS = (['L0', 'L1', 'L2', 'L3'] as RiskLevel[]).map((r) => ({
  value: r,
  label: `${r} ${RISK_LABELS[r] ?? ''}`,
}));

/** 策略与档位。 */
export function PolicySection() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listPolicies();
      setPolicies(res.policies);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (p: Policy) => {
    setBusyId(p.id);
    try {
      await adminApi.updatePolicy(p.id, { enabled: !p.enabled });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: Policy) => {
    setBusyId(p.id);
    try {
      await adminApi.deletePolicy(p.id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={policies}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}
        ListHeaderComponent={
          <Card style={{ marginBottom: 4 }}>
            <Text variant="subtitle">策略与档位</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2, marginBottom: 10 }}>
              会话档位优先；策略提供兜底档位与约束（风险上限、禁区话题、频率）。
            </Text>
            <Button variant="outline" label="新建策略" onPress={() => setCreateOpen(true)} />
          </Card>
        }
        renderItem={({ item: p }) => (
          <Card padding={12}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="body" style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>
                {p.name || p.scopeType}
              </Text>
              {busyId === p.id ? (
                <Spinner inline />
              ) : (
                <Toggle
                  value={p.enabled}
                  onValueChange={() => void toggle(p)}
                  label={`${p.name || p.scopeType} 策略`}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                tone="danger"
                fullWidth={false}
                label="删除"
                disabled={busyId === p.id}
                onPress={() => void remove(p)}
              />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <Badge
                label={SCOPE_OPTIONS.find((s) => s.value === p.scopeType)?.label ?? p.scopeType}
              />
              <Badge label={`档位 ${MODE_LABELS[p.rule.mode] ?? p.rule.mode}`} tone="ai" />
              <Badge
                label={`上限 ${RISK_LABELS[p.rule.maxRisk] ?? p.rule.maxRisk}`}
                tone="outline"
              />
              {p.rule.rateLimitPerHour ? (
                <Badge label={`${p.rule.rateLimitPerHour}/小时`} tone="outline" />
              ) : null}
            </View>
            {p.rule.denyTopics.length > 0 ? (
              <Text variant="micro" tone="muted" style={{ marginTop: 6 }}>
                禁区话题：{p.rule.denyTopics.join('、')}
              </Text>
            ) : null}
          </Card>
        )}
        ListEmptyComponent={
          loading ? (
            <Spinner />
          ) : (
            <EmptyState
              icon="shield-check-line"
              title="暂无策略"
              description="新建策略为分身设定兜底档位与约束"
            />
          )
        }
      />
      <PolicyCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void load()}
      />
    </View>
  );
}

function PolicyCreateSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [scopeType, setScopeType] = useState<(typeof SCOPE_OPTIONS)[number]['value']>('global');
  const [scopeId, setScopeId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<(typeof MODE_OPTIONS)[number]['value']>('auto');
  const [maxRisk, setMaxRisk] = useState<RiskLevel>('L1');
  const [rateLimit, setRateLimit] = useState('20');
  const [denyTopics, setDenyTopics] = useState('money');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setScopeType('global');
      setScopeId('');
      setName('');
      setMode('auto');
      setMaxRisk('L1');
      setRateLimit('20');
      setDenyTopics('money');
    }
  }, [open]);

  const create = async () => {
    setBusy(true);
    try {
      await adminApi.createPolicy({
        scopeType,
        scopeId: scopeId.trim() || null,
        name: name.trim() || `${SCOPE_OPTIONS.find((s) => s.value === scopeType)?.label}策略`,
        rule: {
          mode,
          schedule: [],
          allowCapabilities: null,
          denyTopics: denyTopics
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
          maxRisk,
          rateLimitPerHour: Number(rateLimit) || 20,
          escalateWhen: [],
        },
      });
      onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={open} onClose={onClose} title="新建策略" scroll>
      <Field label="作用域">
        <ChipRow options={SCOPE_OPTIONS} value={scopeType} onChange={setScopeType} />
      </Field>
      {scopeType !== 'global' ? (
        <Field label="作用域 ID">
          <Input
            value={scopeId}
            onChangeText={setScopeId}
            placeholder={
              scopeType === 'contact'
                ? '联系人 userId'
                : scopeType === 'conversation'
                  ? '会话 id'
                  : '可选'
            }
            autoCapitalize="none"
          />
        </Field>
      ) : null}
      <Field label="名称">
        <Input value={name} onChangeText={setName} placeholder="如：家人自动档" />
      </Field>
      <Field label="兜底档位">
        <ChipRow options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </Field>
      <Field label="自动执行风险上限">
        <ChipRow options={RISK_OPTIONS} value={maxRisk} onChange={setMaxRisk} />
      </Field>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field label="每小时上限" style={{ flex: 1 }}>
          <Input value={rateLimit} onChangeText={setRateLimit} keyboardType="number-pad" />
        </Field>
        <Field label="禁区话题" style={{ flex: 1 }}>
          <Input value={denyTopics} onChangeText={setDenyTopics} placeholder="money, health" />
        </Field>
      </View>
      <Button label="创建" loading={busy} onPress={() => void create()} style={{ marginTop: 14 }} />
    </BottomSheet>
  );
}
