import { api, type DeviceView, useAuthStore, useChatStore } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConversationRow } from '@/components/conversations/conversation-row';
import { NewConversationSheet } from '@/components/conversations/new-conversation-sheet';
import { useTheme } from '@/hooks/use-theme';
import { ensurePushRegistered } from '@/push';
import { connectRealtime, disconnectRealtime } from '@/realtime';
import { Avatar, Button, EmptyState, IconButton, PageHeader, SearchField, Text } from '@/ui';

export default function ChatsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const conversations = useChatStore((s) => s.conversations);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  const [refreshing, setRefreshing] = useState(false);
  const [otherDevice, setOtherDevice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    connectRealtime();
    void loadConversations().catch(() => undefined);
    // 推送注册（best-effort：权限拒绝/拿不到 token 时静默降级）
    void ensurePushRegistered();
    // 多端在线条：展示最近活跃的其他端
    void api
      .listDevices()
      .then((res) => {
        const label: Record<string, string> = {
          ios: '手机端',
          android: '手机端',
          desktop: '桌面端',
          web: '网页端',
        };
        const other = (res.devices as DeviceView[]).find(
          (d) => d.platform !== (Platform.OS === 'android' ? 'android' : 'ios'),
        );
        setOtherDevice(other ? (label[other.platform] ?? other.platform) : null);
      })
      .catch(() => undefined);
    return () => disconnectRealtime();
  }, [token, loadConversations]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadConversations();
    } finally {
      setRefreshing(false);
    }
  }, [loadConversations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      `${c.displayTitle} ${c.lastMsgPreview ?? ''}`.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  return (
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <PageHeader
        large
        avatar={<Avatar name={user?.name ?? '我'} size={44} />}
        title="消息"
        subtitle={user?.department || user?.email}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <IconButton
              icon="search-line"
              label="搜索会话"
              size={38}
              tone={searchOpen ? 'primary' : 'default'}
              onPress={() => {
                setSearchOpen((v) => !v);
                if (searchOpen) setQuery('');
              }}
            />
            <IconButton
              icon="add-circle-line"
              label="新建会话"
              size={38}
              onPress={() => setNewOpen(true)}
            />
          </View>
        }
      />

      {searchOpen ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <SearchField
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="搜索"
            onCancel={() => {
              setSearchOpen(false);
              setQuery('');
            }}
          />
        </View>
      ) : null}

      {otherDevice && !searchOpen ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 9,
            backgroundColor: t.bg,
          }}
        >
          <Icon name="computer-line" size={16} color={t.textMuted} />
          <Text variant="caption" tone="muted">
            {otherDevice}已登录
          </Text>
        </View>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.conversation.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 12 }}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: t.separator,
              marginLeft: 76,
            }}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={t.primary}
          />
        }
        renderItem={({ item }) => (
          <ConversationRow
            view={item}
            myId={user?.id ?? ''}
            onPress={() => router.push(`/chat/${item.conversation.id}`)}
          />
        )}
        ListEmptyComponent={
          query.trim() ? (
            <EmptyState icon="search-line" title="没有匹配的会话" description="换个关键词试试" />
          ) : (
            <EmptyState
              icon="chat-3-line"
              title="还没有会话"
              description="点右上角 + 添加联系人并开始聊天"
              action={
                <Button
                  label="新建会话"
                  size="sm"
                  fullWidth={false}
                  onPress={() => setNewOpen(true)}
                />
              }
            />
          )
        }
      />

      <NewConversationSheet
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          void loadConversations();
          setNewOpen(false);
          router.push(`/chat/${id}`);
        }}
      />
    </View>
  );
}
