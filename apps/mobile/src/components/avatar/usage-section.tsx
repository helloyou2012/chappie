import type { UsageDay } from '@chappie/shared';
import { FlatList, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Card, Divider, EmptyState, Text } from '@/ui';

export type UsageSummary = {
  usage: UsageDay[];
  todayCostUsd: number;
  dailyBudgetUsd: number;
} | null;

/** 用量：今日花费 / 预算进度 / 近 7 天明细。 */
export function UsageSection({ usage }: { usage: UsageSummary }) {
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
