import { adminApi, RISK_LABELS } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Badge, Card, EmptyState, Spinner, Text, Toggle } from '@/ui';

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

/** 能力授权。 */
export function CapabilitiesSection() {
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
              <Toggle
                value={row.grant.granted}
                onValueChange={() => void toggle(row)}
                label={`${row.capability.name} 授权`}
              />
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
