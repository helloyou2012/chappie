import { type Approval, adminApi, api, formatRelative } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';

export default function ApprovalsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.listApprovals({ status: 'pending' });
      setApprovals(res.approvals);
    } catch {
      setApprovals([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  const resolve = async (a: Approval, action: 'approve' | 'reject') => {
    if (!a.cardMsgId) return;
    setBusyId(a.id);
    try {
      await api.cardAction(a.cardMsgId, { action });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: t.text }}>审批中心</Text>
        <Text style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
          分身代你执行 L2 高风险操作前需要确认，超时自动拒绝。
        </Text>
      </View>
      <FlatList
        data={approvals}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={t.primary}
          />
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: t.card,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.warning,
              padding: 13,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="shield-keyhole-line" size={16} color={t.warning} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: t.text }}>
                {item.title}
              </Text>
              <Text style={{ fontSize: 10, color: t.warning }}>待确认</Text>
            </View>
            <Text style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>
              工具 {item.toolName} · {formatRelative(item.createdAt)}
            </Text>
            <View style={{ backgroundColor: t.bubble, borderRadius: 8, padding: 8, marginTop: 8 }}>
              <Text style={{ fontSize: 10, color: t.textMuted }} numberOfLines={4}>
                {JSON.stringify(item.args)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Pressable
                onPress={() => void resolve(item, 'approve')}
                disabled={busyId === item.id}
                style={{
                  backgroundColor: t.primary,
                  borderRadius: 10,
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  opacity: busyId === item.id ? 0.5 : 1,
                }}
              >
                <Text style={{ color: t.primaryFg, fontWeight: '600', fontSize: 13 }}>批准</Text>
              </Pressable>
              <Pressable
                onPress={() => void resolve(item, 'reject')}
                disabled={busyId === item.id}
                style={{
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 10,
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  opacity: busyId === item.id ? 0.5 : 1,
                }}
              >
                <Text style={{ color: t.text, fontSize: 13 }}>拒绝</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 50 }}>
            <Text style={{ fontSize: 13, color: t.textMuted }}>暂无待确认事项</Text>
          </View>
        }
      />
    </View>
  );
}
