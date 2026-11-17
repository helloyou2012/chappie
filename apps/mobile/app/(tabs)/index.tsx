import {
  api,
  type ContactView,
  type ConversationView,
  type DeviceView,
  formatTime,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Platform, RefreshControl, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { ensurePushRegistered } from '@/push';
import { connectRealtime, disconnectRealtime } from '@/realtime';
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  EmptyState,
  IconButton,
  Input,
  ListRow,
  PageHeader,
  SegmentedControl,
  Spinner,
  Text,
} from '@/ui';

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
  const isGroup = view.conversation.type === 'group';
  const fromMe = view.lastMsgSenderId === myId;
  const muted = view.myAiMode === 'off';
  // 群聊预览带发送者（「陈美丽: 内容」），与微信/飞书一致
  const prefix =
    isGroup && !fromMe && view.lastMsgSenderName
      ? `${view.lastMsgSenderName}：`
      : fromMe
        ? '我：'
        : '';

  return (
    <ListRow
      leading={
        <View style={{ position: 'relative' }}>
          <Avatar
            name={view.displayTitle}
            variant={isSelf ? 'avatar' : isGroup ? 'group' : 'human'}
            size={44}
          />
          {view.unreadCount > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -1,
                right: -1,
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: t.danger,
                borderWidth: 1.5,
                borderColor: t.card,
              }}
            />
          ) : null}
        </View>
      }
      title={view.displayTitle}
      titleTrailing={
        <>
          {isSelf ? <Badge label="分身" tone="ai" /> : null}
          {isGroup ? <Badge label="群聊" /> : null}
          {muted ? <Icon name="notification-off-line" size={12} color={t.textTertiary} /> : null}
        </>
      }
      subtitle={`${prefix}${view.lastMsgPreview ?? '暂无消息'}`}
      trailing={
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text variant="micro" tone="muted">
            {formatTime(view.lastMsgAt)}
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
              <Text variant="micro" tone="onPrimary" style={{ fontWeight: '600' }}>
                {view.unreadCount > 99 ? '99+' : view.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
      }
      onPress={onPress}
      accessibilityLabel={`${view.displayTitle}，${view.lastMsgPreview ?? '暂无消息'}`}
    />
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

  const [refreshing, setRefreshing] = useState(false);
  const [otherDevice, setOtherDevice] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!token) return;
    connectRealtime();
    void loadConversations().catch(() => undefined);
    // 推送注册（best-effort：权限拒绝/拿不到 token 时静默降级）
    void ensurePushRegistered();
    // 多端在线条：展示最近活跃的其他端（参考微信「Mac已登录」）
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

  const openNew = async () => {
    setNewOpen(true);
    setContactEmail('');
    setSelected([]);
    setTitle('');
    setTab('direct');
    setContactsLoading(true);
    try {
      const res = await api.listContacts();
      setContacts(res.contacts);
    } catch {
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  };

  const addContact = async () => {
    const email = contactEmail.trim();
    if (!email) return;
    setAdding(true);
    try {
      const res = await api.addContact({ email });
      setContacts((prev) =>
        prev.some((c) => c.user.id === res.contact.user.id) ? prev : [...prev, res.contact],
      );
      setContactEmail('');
    } finally {
      setAdding(false);
    }
  };

  const create = async () => {
    if (selected.length === 0) return;
    setCreating(true);
    try {
      const res = await api.createConversation({
        type: tab,
        memberUserIds: selected,
        title: tab === 'group' ? title.trim() || '新群聊' : undefined,
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
      <PageHeader
        large
        title="消息"
        subtitle={user?.email}
        right={
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <IconButton
              icon="add-line"
              label="新建会话"
              tone="primary"
              filled
              onPress={() => void openNew()}
            />
          </View>
        }
      />

      {otherDevice ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 20,
            paddingBottom: 6,
          }}
        >
          <Icon name="computer-line" size={14} color={t.textTertiary} />
          <Text variant="micro" tone="muted">
            {otherDevice}已登录
          </Text>
        </View>
      ) : null}

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.conversation.id}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: insets.bottom + 12 }}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: t.border, marginLeft: 70 }} />
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
          <EmptyState
            icon="chat-3-line"
            title="还没有会话"
            description="点右上角 + 添加联系人并开始聊天"
            action={
              <Button label="新建会话" size="sm" fullWidth={false} onPress={() => void openNew()} />
            }
          />
        }
      />

      <BottomSheet
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        title="新建会话"
        description="选择联系人发起单聊，或创建群聊。对方与双方的分身会一同加入。"
        maxHeight="82%"
      >
        <SegmentedControl
          options={[
            { value: 'direct', label: '单聊' },
            { value: 'group', label: '群聊' },
          ]}
          value={tab}
          onChange={(v) => {
            setTab(v);
            setSelected([]);
          }}
          style={{ marginBottom: 8 }}
        />
        {tab === 'group' ? (
          <Input
            value={title}
            onChangeText={setTitle}
            placeholder="群聊名称（可选）"
            style={{ marginBottom: 8 }}
          />
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <Input
            size="sm"
            value={contactEmail}
            onChangeText={setContactEmail}
            placeholder="按邮箱添加联系人（对方需已注册）"
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ flex: 1 }}
          />
          <Button
            size="sm"
            variant="outline"
            fullWidth={false}
            label={adding ? '添加中' : '添加'}
            loading={adding}
            disabled={!contactEmail.trim()}
            onPress={() => void addContact()}
          />
        </View>

        {contactsLoading ? (
          <Spinner />
        ) : (
          <FlatList
            data={contacts}
            keyExtractor={(c) => c.user.id}
            style={{ maxHeight: 280 }}
            renderItem={({ item }) => {
              const checked = selected.includes(item.user.id);
              return (
                <ListRow
                  leading={<Avatar name={item.user.name} size={34} />}
                  title={item.user.name}
                  subtitle={item.user.email}
                  selected={checked}
                  trailing={checked ? <Icon name="check-line" size={18} color={t.primary} /> : null}
                  onPress={() => {
                    if (tab === 'direct') setSelected([item.user.id]);
                    else
                      setSelected((prev) =>
                        prev.includes(item.user.id)
                          ? prev.filter((x) => x !== item.user.id)
                          : [...prev, item.user.id],
                      );
                  }}
                />
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="contacts-line"
                title="还没有联系人"
                description="用上方邮箱框添加，对方注册后即可发起会话"
              />
            }
          />
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button
            label={tab === 'direct' ? '发起单聊' : `创建群聊（${selected.length}）`}
            loading={creating}
            disabled={selected.length === 0}
            onPress={() => void create()}
            style={{ flex: 1 }}
          />
          <Button
            label="取消"
            variant="outline"
            fullWidth={false}
            onPress={() => setNewOpen(false)}
          />
        </View>
      </BottomSheet>
    </View>
  );
}
