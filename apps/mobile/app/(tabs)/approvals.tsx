import { type Approval, adminApi, api, useAuthStore } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApprovalRow } from '@/components/approvals/approval-row';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, EmptyState, IconButton, PageHeader, SegmentedControl } from '@/ui';

export default function ApprovalsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
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
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <PageHeader
        large
        avatar={<Avatar name={user?.name ?? '我'} size={44} />}
        title="审批"
        subtitle="分身执行 L2 高风险操作前需要你确认"
        right={
          <IconButton
            icon="refresh-line"
            label="刷新审批"
            size={38}
            tone="muted"
            onPress={() => void load(tab)}
          />
        }
      />
      <SegmentedControl
        variant="underline"
        options={[
          { value: 'pending', label: '待确认' },
          { value: 'all', label: '全部' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <FlatList
        data={approvals}
        style={{ flex: 1 }}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 14 }}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: t.separator,
              marginLeft: 16,
            }}
          />
        )}
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
        renderItem={({ item }) => (
          <ApprovalRow
            approval={item}
            busy={busyId === item.id}
            onApprove={() => void resolve(item, 'approve')}
            onReject={() => void resolve(item, 'reject')}
          />
        )}
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
