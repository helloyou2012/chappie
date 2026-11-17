import { type Approval, adminApi, api, formatRelative } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { Badge, Button, Card, EmptyState, PageHeader, SegmentedControl, Text } from '@/ui';

const STATUS: Record<string, { label: string; tone: 'muted' | 'success' | 'warning' | 'danger' }> =
  {
    pending: { label: '待确认', tone: 'warning' },
    approved: { label: '已批准', tone: 'success' },
    modified: { label: '修改后批准', tone: 'success' },
    rejected: { label: '已拒绝', tone: 'danger' },
    expired: { label: '已超时', tone: 'muted' },
  };

export default function ApprovalsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (which: 'pending' | 'all') => {
    try {
      const res = await adminApi.listApprovals(
        which === 'pending' ? { status: 'pending' } : undefined,
      );
      setApprovals(res.approvals);
    } catch {
      setApprovals([]);
    }
  }, []);

  useEffect(() => {
    void load(tab);
    const timer = setInterval(() => void load(tab), 15000);
    return () => clearInterval(timer);
  }, [tab, load]);

  const resolve = async (a: Approval, action: 'approve' | 'reject') => {
    if (!a.cardMsgId) return;
    setBusyId(a.id);
    try {
      await api.cardAction(a.cardMsgId, { action });
      await load(tab);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <PageHeader
        large
        title="审批中心"
        subtitle="分身执行 L2 高风险操作前需要你确认，超时自动拒绝"
      />
      <View style={{ paddingHorizontal: 16 }}>
        <SegmentedControl
          options={[
            { value: 'pending', label: '待确认' },
            { value: 'all', label: '全部' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      <FlatList
        data={approvals}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 14, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(tab).finally(() => setRefreshing(false));
            }}
            tintColor={t.primary}
          />
        }
        renderItem={({ item }) => {
          const pending = item.status === 'pending';
          const status = STATUS[item.status] ?? { label: item.status, tone: 'muted' as const };
          return (
            <Card tone={pending ? 'warning' : 'default'} padding={13}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="subtitle" style={{ flex: 1 }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Badge label={status.label} tone={status.tone} />
              </View>
              <Text variant="micro" tone="muted" style={{ marginTop: 4 }}>
                工具 {item.toolName} · {formatRelative(item.createdAt)}
              </Text>
              <View
                style={{ backgroundColor: t.bubble, borderRadius: 8, padding: 8, marginTop: 8 }}
              >
                <Text variant="micro" tone="muted" numberOfLines={4}>
                  {JSON.stringify(item.args, null, 2)}
                </Text>
              </View>
              <Text variant="micro" tone="muted" style={{ marginTop: 6 }}>
                请求 {formatRelative(item.createdAt)} · 超时 {formatRelative(item.expiresAt)}
              </Text>
              {pending ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
                  <Button
                    size="sm"
                    fullWidth={false}
                    label="批准"
                    loading={busyId === item.id}
                    disabled={!item.cardMsgId}
                    onPress={() => void resolve(item, 'approve')}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    label="拒绝"
                    disabled={busyId === item.id || !item.cardMsgId}
                    onPress={() => void resolve(item, 'reject')}
                  />
                  <Text
                    variant="micro"
                    tone="muted"
                    align="right"
                    style={{ flex: 1 }}
                    numberOfLines={2}
                  >
                    改参数请到「我的分身」会话卡片中处理
                  </Text>
                </View>
              ) : null}
            </Card>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="shield-check-line"
            title={tab === 'pending' ? '暂无待确认事项' : '暂无审批记录'}
            description="分身遇到高风险操作时会在这里等你"
          />
        }
      />
    </View>
  );
}
