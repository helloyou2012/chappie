import { adminApi, formatRelative, type MemoryItem } from '@chappie/shared';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Badge, Button, Card, EmptyState, Input, SegmentedControl, Spinner, Text } from '@/ui';

const MEMORY_SCOPES = [
  { value: 'all', label: '全部' },
  { value: 'global', label: '通用' },
  { value: 'contact', label: '联系人' },
] as const;

const MEMORY_TYPE_LABEL: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  commitment: '承诺',
  relationship: '关系',
  procedure: '习惯做法',
  episode: '事件',
};

/** 记忆：按作用域查看、删除、按主题忘记。 */
export function MemorySection() {
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
