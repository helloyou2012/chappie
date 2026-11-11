import { contentText } from '@chappie/contract';
import {
  api,
  dayjs,
  formatTime,
  type Message,
  type PendingMessage,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type CardAction, MessageBubble } from '@/components/message';
import { useTheme } from '@/hooks/use-theme';
import { realtime } from '@/realtime';
import { modeLabels } from '@/theme';

const MODE_CYCLE = ['manual', 'draft', 'auto', 'off'] as const;

export default function ChatScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const convId = typeof params.id === 'string' ? params.id : '';

  const conversations = useChatStore((s) => s.conversations);
  const messagesByConv = useChatStore((s) => s.messagesByConv);
  const membersByConv = useChatStore((s) => s.membersByConv);
  const pendingByConv = useChatStore((s) => s.pendingByConv);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadMembers = useChatStore((s) => s.loadMembers);
  const setActiveConv = useChatStore((s) => s.setActiveConv);
  const updateMode = useChatStore((s) => s.updateConversationMode);
  const addPending = useChatStore((s) => s.addPending);
  const myId = useAuthStore((s) => s.user?.id ?? '');

  const view = conversations.find((c) => c.conversation.id === convId);
  const messages = messagesByConv[convId] ?? [];
  const members = membersByConv[convId] ?? [];
  const pending = pendingByConv[convId] ?? [];

  type ListItem =
    | { kind: 'message'; message: Message }
    | { kind: 'pending'; pending: PendingMessage };
  const listData: ListItem[] = [
    ...messages.map((m) => ({ kind: 'message' as const, message: m })),
    ...pending.map((p) => ({ kind: 'pending' as const, pending: p })),
  ];

  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!convId) return;
    setActiveConv(convId);
    void loadMessages(convId).catch(() => undefined);
    void loadMembers(convId).catch(() => undefined);
    return () => setActiveConv(null);
  }, [convId, setActiveConv, loadMessages, loadMembers]);

  useEffect(() => {
    if (!convId) return;
    const last = messages[messages.length - 1];
    if (last && last.seq > (view?.myLastReadSeq ?? 0)) {
      realtime()?.markRead(convId, last.seq);
      useChatStore.getState().markReadLocal(convId, last.seq);
    }
  }, [convId, messages.length, view?.myLastReadSeq, messages]);

  useEffect(() => {
    if (messages.length + pending.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length, pending.length]);

  const send = () => {
    const value = text.trim();
    if (!value || !convId) return;
    const ws = realtime();
    if (!ws?.isOpen) return;
    const content = { type: 'text' as const, schemaVersion: 1, text: value };
    const clientMsgId = ws.sendMessage(convId, content, { mentions });
    addPending({
      clientMsgId,
      convId,
      content,
      mentions,
      replyTo: null,
      createdAt: dayjs().toISOString(),
    });
    setText('');
    setMentions([]);
  };

  const onCardAction = (msgId: string, action: CardAction) => {
    void api.cardAction(msgId, { action }).catch(() => undefined);
  };

  const cycleMode = () => {
    if (!view || !convId) return;
    const idx = MODE_CYCLE.indexOf(view.myAiMode as (typeof MODE_CYCLE)[number]);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    void updateMode(convId, next).catch(() => undefined);
  };

  const mentionCandidates = members.filter((m) => m.principalId !== myId);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* 头部 */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 14,
          backgroundColor: t.card,
          borderBottomWidth: 1,
          borderBottomColor: t.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Icon name="arrow-left-s-line" size={24} color={t.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: t.text }} numberOfLines={1}>
            {view?.displayTitle ?? '会话'}
          </Text>
          <Text style={{ fontSize: 11, color: t.textMuted }}>
            {members.filter((m) => m.principalType === 'human').length} 位成员 ·{' '}
            {members.filter((m) => m.principalType === 'avatar').length} 个分身
          </Text>
        </View>
        <Pressable
          onPress={cycleMode}
          style={{
            borderRadius: 10,
            backgroundColor: t.bg,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: t.primary }}>
            {modeLabels[view?.myAiMode ?? 'manual']}
          </Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={listData}
        keyExtractor={(item) =>
          item.kind === 'pending' ? `p_${item.pending.clientMsgId}` : item.message.msgId
        }
        renderItem={({ item }) => {
          if (item.kind === 'pending') {
            return (
              <View
                style={{
                  alignItems: 'flex-end',
                  paddingHorizontal: 14,
                  paddingVertical: 5,
                  opacity: 0.6,
                }}
              >
                <Text style={{ fontSize: 10, color: t.textMuted, marginBottom: 3 }}>
                  我 · {formatTime(item.pending.createdAt)} · 发送中
                </Text>
                <View
                  style={{
                    backgroundColor: t.primary,
                    borderRadius: 16,
                    paddingHorizontal: 13,
                    paddingVertical: 9,
                    maxWidth: '82%',
                  }}
                >
                  <Text style={{ fontSize: 15, color: t.primaryFg }}>
                    {contentText(item.pending.content)}
                  </Text>
                </View>
              </View>
            );
          }
          return (
            <MessageBubble
              message={item}
              members={members}
              myId={myId}
              onCardAction={onCardAction}
            />
          );
        }}
        contentContainerStyle={{ paddingVertical: 10 }}
      />

      {/* 提及候选 */}
      {mentionCandidates.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ maxHeight: 40, borderTopWidth: 1, borderTopColor: t.border }}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 5, gap: 6 }}
        >
          {mentionCandidates.map((m) => {
            const active = mentions.includes(m.principalId);
            return (
              <Pressable
                key={m.principalId}
                onPress={() =>
                  setMentions((prev) =>
                    prev.includes(m.principalId)
                      ? prev.filter((x) => x !== m.principalId)
                      : [...prev, m.principalId],
                  )
                }
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  backgroundColor: active ? t.primary : t.card,
                  borderWidth: 1,
                  borderColor: active ? t.primary : t.border,
                }}
              >
                <Text style={{ fontSize: 12, color: active ? t.primaryFg : t.text }}>
                  @{m.name}
                  {m.principalType === 'avatar' ? ' ✨' : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* 输入栏 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 10),
          borderTopWidth: 1,
          borderTopColor: t.border,
          backgroundColor: t.card,
        }}
      >
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            realtime()?.typing(convId);
          }}
          placeholder="输入消息…"
          placeholderTextColor={t.textMuted}
          multiline
          style={{
            flex: 1,
            maxHeight: 110,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: t.border,
            paddingHorizontal: 14,
            paddingVertical: 9,
            fontSize: 15,
            color: t.text,
            backgroundColor: t.bg,
          }}
        />
        <Pressable
          onPress={send}
          disabled={!text.trim()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: text.trim() ? t.primary : t.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="send-plane-fill" size={17} color={t.primaryFg} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
