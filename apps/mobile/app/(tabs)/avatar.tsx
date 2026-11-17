import {
  ApiError,
  type Avatar,
  adminApi,
  formatRelative,
  type MemoryItem,
  MODE_LABELS,
  type Policy,
  RISK_LABELS,
  type RiskLevel,
  type UsageDay,
} from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import {
  Badge,
  BottomSheet,
  Button,
  Card,
  ChipRow,
  Divider,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SegmentedControl,
  Spinner,
  Text,
  Toggle,
} from '@/ui';

type Section = 'persona' | 'policy' | 'capabilities' | 'memory' | 'usage';

const SECTIONS = [
  { value: 'persona', label: '人设' },
  { value: 'policy', label: '策略' },
  { value: 'capabilities', label: '能力' },
  { value: 'memory', label: '记忆' },
  { value: 'usage', label: '用量' },
] as const;

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

const MEMORY_TYPE_LABEL: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  commitment: '承诺',
  relationship: '关系',
  procedure: '习惯做法',
  episode: '事件',
};

export default function AvatarScreen() {
  const t = useTheme();
  const [section, setSection] = useState<Section>('persona');
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [usage, setUsage] = useState<{
    usage: UsageDay[];
    todayCostUsd: number;
    dailyBudgetUsd: number;
  } | null>(null);

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
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <PageHeader title="我的分身" subtitle="策略、能力与记忆都在这里管理" />
      {!avatar ? (
        <>
          <Spinner size="large" />
          <Text variant="caption" tone="muted" align="center">
            分身初始化中…
          </Text>
        </>
      ) : (
        <>
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <Card padding={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 15,
                  backgroundColor: t.aiBubble,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="robot-2-line" size={24} color={t.aiText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h2" numberOfLines={1}>
                  {avatar.name}
                </Text>
                <Badge
                  label={avatar.status === 'frozen' ? '已冻结' : '运行中'}
                  tone={avatar.status === 'frozen' ? 'danger' : 'success'}
                />
              </View>
              <FreezeButton avatar={avatar} onChange={setAvatar} />
            </Card>

            <SegmentedControl options={SECTIONS} value={section} onChange={setSection} />
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

function FreezeButton({ avatar, onChange }: { avatar: Avatar; onChange: (a: Avatar) => void }) {
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

function PersonaSection({ avatar, onSaved }: { avatar: Avatar; onSaved: (a: Avatar) => void }) {
  const t = useTheme();
  const [name, setName] = useState(avatar.name);
  const [persona, setPersona] = useState(avatar.persona);
  const [budget, setBudget] = useState(String(avatar.dailyBudgetUsd));
  const [saving, setSaving] = useState(false);
  const [previewText, setPreviewText] = useState('明天上午有空吗？想约你聊一下合作。');
  const [previewReply, setPreviewReply] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminApi.updateAvatar({
        name: name.trim() || undefined,
        persona: persona.trim(),
        dailyBudgetUsd: Number(budget) > 0 ? Number(budget) : undefined,
      });
      onSaved(res.avatar);
    } finally {
      setSaving(false);
    }
  };

  const preview = async () => {
    if (!previewText.trim()) return;
    setPreviewing(true);
    setPreviewReply(null);
    try {
      const res = await adminApi.preview(previewText.trim());
      setPreviewReply(res.reply);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <FlatList
      data={[0]}
      keyExtractor={() => 'persona'}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
      renderItem={() => (
        <>
          <Card>
            <Text variant="subtitle">分身人设</Text>
            <Field label="名称">
              <Input value={name} onChangeText={setName} />
            </Field>
            <Field label="人设描述">
              <Input
                value={persona}
                onChangeText={setPersona}
                multiline
                minHeight={100}
                placeholder="例如：你是 Alice 的 AI 分身，语气亲切简洁，回复不超过三句话…"
              />
            </Field>
            <Field label="每日预算（美元）" hint="超出预算后自动档将降级为手动档并通知你">
              <Input value={budget} onChangeText={setBudget} keyboardType="decimal-pad" />
            </Field>
            <Button
              label={saving ? '保存中…' : '保存人设'}
              loading={saving}
              onPress={() => void save()}
              style={{ marginTop: 12 }}
            />
          </Card>

          <Card>
            <Text variant="subtitle">风格预览</Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              输入一句话，看看分身会怎么回复（按当前人设实时生成）。
            </Text>
            <Field>
              <Input
                value={previewText}
                onChangeText={setPreviewText}
                multiline
                minHeight={64}
                placeholder="模拟一条对方发来的消息…"
              />
            </Field>
            <Button
              label={previewing ? '生成中…' : '试一下'}
              variant="outline"
              loading={previewing}
              onPress={() => void preview()}
              style={{ marginTop: 10 }}
            />
            {previewReply ? (
              <View
                style={{
                  marginTop: 10,
                  backgroundColor: t.aiBubble,
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <Text variant="bodySm" tone="ai" style={{ lineHeight: 19 }}>
                  {previewReply}
                </Text>
              </View>
            ) : null}
          </Card>
        </>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// 策略
// ---------------------------------------------------------------------------

function PolicySection() {
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
                <Toggle value={p.enabled} onValueChange={() => void toggle(p)} />
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
          escalateWhen: ['confidence<0.7'],
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

// ---------------------------------------------------------------------------
// 能力授权
// ---------------------------------------------------------------------------

interface CapRow {
  capability: {
    id: string;
    name: string;
    description: string;
    riskLevel: string;
    provider: string;
    version: number;
    schema: Record<string, unknown>;
  };
  grant: { granted: boolean; constraints: Record<string, unknown> };
}

const RISK_TONE: Record<string, 'success' | 'muted' | 'warning' | 'danger'> = {
  L0: 'success',
  L1: 'muted',
  L2: 'warning',
  L3: 'danger',
};

function CapabilitiesSection() {
  const [rows, setRows] = useState<CapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listCapabilities();
      setRows(res.capabilities as CapRow[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (row: CapRow) => {
    setBusyId(row.capability.id);
    try {
      const granted = !row.grant.granted;
      await adminApi.updateGrant(row.capability.id, { granted });
      setRows((prev) =>
        prev.map((r) =>
          r.capability.id === row.capability.id ? { ...r, grant: { ...r.grant, granted } } : r,
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.capability.id}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}
      ListHeaderComponent={
        <Card style={{ marginBottom: 4 }}>
          <Text variant="subtitle">能力授权</Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            分身只能调用你授权的工具；L2 高风险操作仍需逐次确认，L3 永不自动执行。
          </Text>
        </Card>
      }
      renderItem={({ item: row }) => (
        <Card padding={12}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="body" style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>
              {row.capability.name}
            </Text>
            <Badge
              label={`${row.capability.riskLevel} · ${RISK_LABELS[row.capability.riskLevel] ?? ''}`}
              tone={RISK_TONE[row.capability.riskLevel] ?? 'muted'}
            />
            {busyId === row.capability.id ? (
              <Spinner inline />
            ) : (
              <Toggle value={row.grant.granted} onValueChange={() => void toggle(row)} />
            )}
          </View>
          <Text variant="micro" tone="muted" style={{ marginTop: 4 }}>
            {row.capability.id} · {row.capability.description}
            {row.capability.riskLevel === 'L2' ? '（每次执行需你确认）' : ''}
          </Text>
        </Card>
      )}
      ListEmptyComponent={loading ? <Spinner /> : <EmptyState title="暂无可用能力" />}
    />
  );
}

// ---------------------------------------------------------------------------
// 记忆
// ---------------------------------------------------------------------------

const MEMORY_SCOPES = [
  { value: 'all', label: '全部' },
  { value: 'global', label: '通用' },
  { value: 'contact', label: '联系人' },
] as const;

function MemorySection() {
  const [scope, setScope] = useState<'all' | 'global' | 'contact'>('all');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [forgetting, setForgetting] = useState(false);
  const [forgotCount, setForgotCount] = useState<number | null>(null);

  const load = useCallback(async (s: 'all' | 'global' | 'contact') => {
    setLoading(true);
    try {
      const res = await adminApi.listMemories({ scope: s });
      setMemories(res.memories);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [scope, load]);

  const remove = async (m: MemoryItem) => {
    await adminApi.deleteMemory(m.id);
    setMemories((prev) => prev.filter((x) => x.id !== m.id));
  };

  const forget = async () => {
    const value = keyword.trim();
    if (!value) return;
    setForgetting(true);
    setForgotCount(null);
    try {
      const res = await adminApi.forgetTopic(value);
      setForgotCount(res.deleted);
      setKeyword('');
      await load(scope);
    } finally {
      setForgetting(false);
    }
  };

  return (
    <FlatList
      data={memories}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}
      ListHeaderComponent={
        <Card style={{ marginBottom: 4 }}>
          <Text variant="subtitle">记忆</Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 2, marginBottom: 10 }}>
            记忆按对话对象隔离；敏感记忆默认不用于对外对话。可随时删除或让它「忘记」。
          </Text>
          <SegmentedControl options={MEMORY_SCOPES} value={scope} onChange={setScope} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <Input
              size="sm"
              value={keyword}
              onChangeText={setKeyword}
              placeholder="忘记某个主题/关键词…"
              style={{ flex: 1 }}
            />
            <Button
              size="sm"
              variant="outline"
              fullWidth={false}
              label={forgetting ? '…' : '忘记'}
              disabled={!keyword.trim()}
              onPress={() => void forget()}
            />
          </View>
          {forgotCount !== null ? (
            <Text variant="micro" tone="success" style={{ marginTop: 6 }}>
              已忘记 {forgotCount} 条相关记忆
            </Text>
          ) : null}
        </Card>
      }
      renderItem={({ item: m }) => (
        <Card padding={12}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                <Badge label={MEMORY_TYPE_LABEL[m.type] ?? m.type} tone="outline" />
                <Badge label={m.scope === 'contact' ? '联系人' : '通用'} />
                {m.sensitivity === 'sensitive' ? <Badge label="敏感" tone="danger" /> : null}
              </View>
              <Text variant="bodySm" style={{ marginTop: 6 }}>
                {m.content}
              </Text>
              <Text variant="micro" tone="muted" style={{ marginTop: 4 }}>
                置信度 {(m.confidence * 100).toFixed(0)}% · {formatRelative(m.createdAt)}
              </Text>
            </View>
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              fullWidth={false}
              label="删除"
              onPress={() => void remove(m)}
            />
          </View>
        </Card>
      )}
      ListEmptyComponent={
        loading ? (
          <Spinner />
        ) : (
          <EmptyState
            icon="brain-line"
            title="暂无记忆"
            description="分身会在对话中逐步学习（承诺、偏好、事实等）"
          />
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 用量
// ---------------------------------------------------------------------------

function UsageSection({
  usage,
}: {
  usage: { usage: UsageDay[]; todayCostUsd: number; dailyBudgetUsd: number } | null;
}) {
  const t = useTheme();
  const pct = usage ? Math.min(100, (usage.todayCostUsd / (usage.dailyBudgetUsd || 1)) * 100) : 0;
  return (
    <FlatList
      data={usage?.usage ?? []}
      keyExtractor={(u) => `${u.day}-${u.provider}-${u.model}`}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}
      ListHeaderComponent={
        <Card>
          <Text variant="subtitle">今日用量</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <Text variant="h2">${(usage?.todayCostUsd ?? 0).toFixed(4)}</Text>
            <Text variant="caption" tone="muted">
              预算 ${(usage?.dailyBudgetUsd ?? 1).toFixed(2)}
            </Text>
          </View>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: t.border,
              overflow: 'hidden',
              marginTop: 6,
            }}
          >
            <View style={{ width: `${pct}%`, height: 6, backgroundColor: t.primary }} />
          </View>
          <Text variant="micro" tone="muted" style={{ marginTop: 6 }}>
            近 7 天 {usage?.usage.reduce((n, u) => n + u.requests, 0) ?? 0} 次请求 ·{' '}
            {usage?.usage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0) ?? 0} tokens
          </Text>
          <Divider style={{ marginTop: 12 }} />
        </Card>
      }
      renderItem={({ item: u }) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="caption" style={{ width: 82 }}>
            {u.day}
          </Text>
          <Text variant="micro" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
            {u.provider}/{u.model}
          </Text>
          <Text variant="micro" tone="muted">
            {u.requests} 次
          </Text>
          <Text variant="caption" style={{ width: 64, textAlign: 'right' }}>
            ${u.costUsd.toFixed(4)}
          </Text>
        </View>
      )}
      ListEmptyComponent={<EmptyState icon="line-chart-line" title="暂无用量记录" />}
    />
  );
}
