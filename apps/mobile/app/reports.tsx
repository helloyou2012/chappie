import { adminApi, type DailyReport, dayjs } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  Screen,
  Spinner,
  Text,
} from '@/ui';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card padding={10} style={{ flex: 1, minWidth: '30%' }}>
      <Text variant="micro" tone="muted">
        {label}
      </Text>
      <Text variant="h2" style={{ marginTop: 2 }}>
        {value}
      </Text>
    </Card>
  );
}

export default function ReportsScreen() {
  const router = useRouter();
  const [date, setDate] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async (day: string) => {
    setLoading(true);
    try {
      const res = await adminApi.getDailyReport(day);
      setReport(res.report);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const shiftDay = (delta: number) => {
    const next = dayjs(date).add(delta, 'day');
    if (next.isAfter(dayjs(), 'day')) return;
    setDate(next.format('YYYY-MM-DD'));
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await adminApi.generateReport();
      setReport(res.report);
    } finally {
      setGenerating(false);
    }
  };

  const isToday = date === dayjs().format('YYYY-MM-DD');

  return (
    <Screen scroll>
      <PageHeader
        large
        title="分身日报"
        subtitle="分身替你回复了谁、做了什么、有哪些待你决定"
        onBack={() => router.back()}
        right={
          <Button
            size="sm"
            fullWidth={false}
            label={generating ? '生成中…' : '生成'}
            loading={generating}
            onPress={() => void generate()}
          />
        }
      />

      {/* 日期切换：日期组居中，刷新固定在右侧 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingHorizontal: 16,
          marginTop: 4,
          position: 'relative',
        }}
      >
        <IconButton
          icon="arrow-left-s-line"
          label="前一天"
          tone="muted"
          onPress={() => shiftDay(-1)}
        />
        <Text variant="bodySm" style={{ fontWeight: '600' }}>
          {date}
        </Text>
        {!isToday ? (
          <Button
            size="sm"
            variant="outline"
            fullWidth={false}
            label="今天"
            onPress={() => setDate(dayjs().format('YYYY-MM-DD'))}
          />
        ) : null}
        <IconButton
          icon="arrow-right-s-line"
          label="后一天"
          tone="muted"
          disabled={isToday}
          onPress={() => shiftDay(1)}
        />
        <View style={{ position: 'absolute', right: 8 }}>
          <IconButton
            icon="refresh-line"
            label="刷新"
            tone="primary"
            onPress={() => void load(date)}
          />
        </View>
      </View>

      {loading ? (
        <Spinner />
      ) : !report ? (
        <EmptyState
          icon="file-chart-line"
          title={`${isToday ? '今天' : date} 还没有日报`}
          description="分身每日 09:00 自动生成，也可以立即生成"
          action={
            <Button
              size="sm"
              fullWidth={false}
              label="生成日报"
              loading={generating}
              onPress={() => void generate()}
            />
          }
        />
      ) : (
        <View style={{ padding: 16, gap: 12 }}>
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text variant="subtitle">今日概述 · {report.day}</Text>
              <Badge label="AI 分身" tone="ai" />
            </View>
            <Text style={{ marginTop: 8, lineHeight: 21 }}>{report.summary}</Text>
          </Card>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Stat label="代发回复" value={report.stats.repliedCount} />
            <Stat label="完成任务" value={report.stats.tasksCompleted} />
            <Stat label="草稿采纳" value={report.stats.draftsSent} />
            <Stat label="草稿丢弃" value={report.stats.draftsDiscarded} />
            <Stat label="转交人工" value={report.stats.handovers} />
            <Stat label="采纳率" value={`${(report.stats.acceptedRate * 100).toFixed(0)}%`} />
          </View>

          <Card>
            <Text variant="subtitle" style={{ marginBottom: 8 }}>
              待你决定
            </Text>
            {report.pendingDecisions.length === 0 ? (
              <Text variant="caption" tone="success">
                没有待处理事项
              </Text>
            ) : (
              report.pendingDecisions.map((d) => (
                <View key={`${d.kind}-${d.title}`} style={{ gap: 2, marginTop: 4 }}>
                  <Text variant="bodySm" style={{ fontWeight: '500' }}>
                    {d.title}
                  </Text>
                  {d.detail ? (
                    <Text variant="micro" tone="muted">
                      {d.detail}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </Card>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="micro" tone="muted">
              今日花费 ${(report.stats.costUsd ?? 0).toFixed(4)}
            </Text>
            <Text variant="micro" tone="muted">
              生成于 {dayjs(report.createdAt).format('MM-DD HH:mm')}
            </Text>
          </View>
        </View>
      )}
    </Screen>
  );
}
