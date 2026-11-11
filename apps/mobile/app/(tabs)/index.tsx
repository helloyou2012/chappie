import {
  api,
  type ConversationView,
  formatTime,
  type User,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { connectRealtime, disconnectRealtime } from '@/realtime';

function ConvRow({
  view,
  myId,
  onPress,
}: {
  view: ConversationView;
  myId: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const isSelf = view.conversation.systemTag === 'avatar_self';
  const preview = view.lastMsgPreview ?? '暂无消息';
  const fromMe = view.lastMsgSenderId === myId;
  const initial = view.displayTitle.slice(0, 2);

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: t.card,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          backgroundColor: isSelf ? t.primary : t.bubble,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '600', color: isSelf ? t.primaryFg : t.text }}>
          {isSelf ? 'AI' : initial}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text
            style={{ fontSize: 15, fontWeight: '600', color: t.text, flex: 1 }}
            numberOfLines={1}
          >
            {view.displayTitle}
          </Text>
          <Text style={{ fontSize: 11, color: t.textMuted }}>{formatTime(view.lastMsgAt)}</Text>
        </View>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 2 }}
        >
          <Text style={{ fontSize: 13, color: t.textMuted, flex: 1 }} numberOfLines={1}>
            {fromMe ? '我：' : ''}
            {preview}
          </Text>
          {view.unreadCount > 0 ? (
            <View
              style={{
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ fontSize: 10, color: t.primaryFg, fontWeight: '600' }}>
                {view.unreadCount > 99 ? '99+' : view.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function ChatsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const conversations = useChatStore((s) => s.conversations);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);

  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [group, setGroup] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!token) return;
    connectRealtime();
    void loadConversations().catch(() => undefined);
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

  const openNew = async () => {
    setNewOpen(true);
    try {
      const res = await api.directory();
      setUsers(res.users);
    } catch {
      setUsers([]);
    }
  };

  const create = async () => {
    if (selected.length === 0) return;
    setCreating(true);
    try {
      const res = await api.createConversation({
        type: group ? 'group' : 'direct',
        memberUserIds: selected,
        title: group ? title.trim() || '新群聊' : undefined,
      });
      await loadConversations();
      setNewOpen(false);
      setSelected([]);
      setTitle('');
      router.push(`/chat/${res.view.conversation.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingBottom: 10,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: t.bg,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: t.text }}>消息</Text>
          <Text style={{ fontSize: 11, color: t.textMuted }}>{user?.email}</Text>
        </View>
        <Pressable
          onPress={() => void openNew()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="add-line" size={20} color={t.primary} />
        </Pressable>
        <Pressable
          onPress={() => void logout()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="logout-box-r-line" size={18} color={t.text} />
        </Pressable>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.conversation.id}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: t.border, marginLeft: 76 }} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={t.primary}
          />
        }
        renderItem={({ item }) => (
          <ConvRow
            view={item}
            myId={user?.id ?? ''}
            onPress={() => router.push(`/chat/${item.conversation.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Text style={{ fontSize: 13, color: t.textMuted }}>还没有会话，点右上角 + 开始</Text>
          </View>
        }
      />

      <Modal
        visible={newOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setNewOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: t.card,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              padding: 18,
              paddingBottom: 18 + insets.bottom,
              maxHeight: '80%',
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: t.text, marginBottom: 10 }}>
              新建会话
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {[false, true].map((g) => (
                <Pressable
                  key={String(g)}
                  onPress={() => {
                    setGroup(g);
                    setSelected([]);
                  }}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: group === g ? t.primary : t.bg,
                  }}
                >
                  <Text style={{ fontSize: 13, color: group === g ? t.primaryFg : t.text }}>
                    {g ? '群聊' : '单聊'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {group ? (
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="群聊名称（可选）"
                placeholderTextColor={t.textMuted}
                style={{
                  borderWidth: 1,
                  borderColor: t.border,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  color: t.text,
                  marginBottom: 10,
                }}
              />
            ) : null}
            <FlatList
              data={users}
              keyExtractor={(u) => u.id}
              style={{ maxHeight: 300 }}
              renderItem={({ item }) => {
                const checked = selected.includes(item.id);
                return (
                  <Pressable
                    onPress={() => {
                      if (!group) setSelected([item.id]);
                      else
                        setSelected((prev) =>
                          prev.includes(item.id)
                            ? prev.filter((x) => x !== item.id)
                            : [...prev, item.id],
                        );
                    }}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 8,
                      borderRadius: 10,
                      backgroundColor: checked ? t.aiBubble : 'transparent',
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ fontSize: 14, color: t.text }}>
                      {item.name}{' '}
                      <Text style={{ color: t.textMuted, fontSize: 11 }}>{item.email}</Text>
                    </Text>
                    {checked ? <Text style={{ color: t.primary }}>✓</Text> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text
                  style={{
                    color: t.textMuted,
                    fontSize: 12,
                    paddingVertical: 16,
                    textAlign: 'center',
                  }}
                >
                  暂无其他用户，可在另一个窗口注册后再试
                </Text>
              }
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => void create()}
                disabled={selected.length === 0 || creating}
                style={{
                  flex: 1,
                  backgroundColor: t.primary,
                  opacity: selected.length === 0 || creating ? 0.5 : 1,
                  borderRadius: 12,
                  paddingVertical: 13,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: t.primaryFg, fontWeight: '600' }}>
                  {creating ? '创建中…' : group ? `创建群聊（${selected.length}）` : '发起单聊'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setNewOpen(false)}
                style={{
                  paddingHorizontal: 18,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: t.border,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: t.text }}>取消</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
