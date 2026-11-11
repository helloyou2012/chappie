import { adminApi, type DailyReport } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';

function Stat({ label, value }: { label: string; value: string | number }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: '30%',
        backgroundColor: t.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.border,
        padding: 10,
      }}
    >
      <Text style={{ fontSize: 10, color: t.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: t.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export default function ReportsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getDailyReport();
      setReport(res.report);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await adminApi.generateReport();
      setReport(res.report);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: t.text }}>分身日报</Text>
          <Text style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
            分身替你回复了谁、做了什么、有哪些待你决定
          </Text>
        </View>
        <Pressable
          onPress={() => void generate()}
          disabled={generating}
          style={{
            backgroundColor: t.primary,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 9,
            opacity: generating ? 0.5 : 1,
          }}
        >
          <Text style={{ color: t.primaryFg, fontSize: 13, fontWeight: '600' }}>
            {generating ? '生成中…' : '生成'}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />
      ) : !report ? (
        <View style={{ alignItems: 'center', paddingVertical: 60 }}>
          <Text style={{ fontSize: 13, color: t.textMuted }}>今天还没有日报，点右上角生成</Text>
        </View>
      ) : (
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: t.text }}>今日概述</Text>
              <Text style={{ fontSize: 11, color: t.textMuted }}>{report.day}</Text>
            </View>
            <Text style={{ fontSize: 14, lineHeight: 21, color: t.text, marginTop: 8 }}>
              {report.summary}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Stat label="代发回复" value={report.stats.repliedCount} />
            <Stat label="完成任务" value={report.stats.tasksCompleted} />
            <Stat label="草稿采纳" value={report.stats.draftsSent} />
            <Stat label="转交人工" value={report.stats.handovers} />
            <Stat label="采纳率" value={`${(report.stats.acceptedRate * 100).toFixed(0)}%`} />
            <Stat label="花费" value={`$${report.stats.costUsd.toFixed(3)}`} />
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
              待你决定
            </Text>
            {report.pendingDecisions.length === 0 ? (
              <Text style={{ fontSize: 12, color: t.success }}>没有待处理事项</Text>
            ) : (
              report.pendingDecisions.map((d, i) => (
                <View
                  key={i}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 }}
                >
                  <Icon name="error-warning-line" size={14} color={t.warning} />
                  <Text style={{ fontSize: 12, color: t.text, flex: 1 }}>
                    {d.title}
                    {d.detail ? <Text style={{ color: t.textMuted }}> · {d.detail}</Text> : null}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
