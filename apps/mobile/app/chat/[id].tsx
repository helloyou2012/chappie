import {
  api,
  type Message,
  type PendingMessage,
  type ReceptionStrategy,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { ChatHeader } from '@/components/chat/chat-header';
import { ChatComposer, type ReplyTarget } from '@/components/chat/composer';
import { PendingMessageBubble } from '@/components/chat/pending-message';
import { ReceptionSheet } from '@/components/chat/reception-sheet';
import { MemberSheet } from '@/components/member-sheet';
import { type CardAction, MessageBubble } from '@/components/message';
import { useTheme } from '@/hooks/use-theme';
import { realtime } from '@/realtime';
import { Button, Text } from '@/ui';

export default function ChatScreen() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const convId = typeof params.id === 'string' ? params.id : '';

  const conversations = useChatStore((s) => s.conversations);
  const messagesByConv = useChatStore((s) => s.messagesByConv);
  const membersByConv = useChatStore((s) => s.membersByConv);
  const pendingByConv = useChatStore((s) => s.pendingByConv);
  const typingByConv = useChatStore((s) => s.typingByConv);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadMembers = useChatStore((s) => s.loadMembers);
  const setActiveConv = useChatStore((s) => s.setActiveConv);
  const loadConversations = useChatStore((s) => s.loadConversations);
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

  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [, setTypingTick] = useState(0);
  const listRef = useRef<FlatList>(null);
  const atBottomRef = useRef(true);
  const prevPendingRef = useRef(0);
  const prevCountRef = useRef(0);
  const prevSigRef = useRef('');

  // typing 事件带截止时间：定时重渲染以便过期的「正在输入」自动消失
  useEffect(() => {
    const timer = setInterval(() => setTypingTick((n) => n + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!convId) return;
    setActiveConv(convId);
    setOlderExhausted(false);
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

  // live-edge 滚动：只有读者位于底部附近才跟随新内容；自己发消息总是跟随。
  // 流式更新不会改变消息数量，用正文/思考/工具活动的签名触发。
  const lastForScroll = messages[messages.length - 1];
  const lastSig = lastForScroll
    ? [
        lastForScroll.content.type === 'text' ? lastForScroll.content.text.length : 0,
        lastForScroll.aiMeta?.thinking?.length ?? 0,
        (lastForScroll.aiMeta?.activity ?? [])
          .map((a) => `${a.status}:${a.content.length}`)
          .join(','),
        lastForScroll.aiMeta?.streaming ? 1 : 0,
      ].join('|')
    : '';
  useEffect(() => {
    if (messages.length + pending.length === 0) return;
    const mineJustSent = pending.length > prevPendingRef.current;
    prevPendingRef.current = pending.length;
    const count = messages.length + pending.length;
    const grew = count > prevCountRef.current;
    prevCountRef.current = count;
    const contentChanged = lastSig !== prevSigRef.current;
    prevSigRef.current = lastSig;
    if (!atBottomRef.current && !mineJustSent) {
      if (contentChanged) setShowJump(true);
      return;
    }
    atBottomRef.current = true;
    setShowJump(false);
    // 新消息平滑；流式增量即时贴底，避免动画排队
    setTimeout(
      () => listRef.current?.scrollToEnd({ animated: grew || mineJustSent }),
      grew || mineJustSent ? 80 : 30,
    );
  }, [messages.length, pending.length, lastSig]);

  const onCardAction = (msgId: string, action: CardAction, editedText?: string) => {
    void api.cardAction(msgId, { action, editedText }).catch(() => undefined);
  };

  const loadMore = async () => {
    if (loadingMore || olderExhausted || !convId || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const before = messages.length;
      await loadMessages(convId, { before: true });
      const after = useChatStore.getState().messagesByConv[convId]?.length ?? 0;
      if (after === before) setOlderExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const takeover = () => {
    if (!convId) return;
    setModeSheetOpen(false);
    void api
      .takeover(convId)
      .then(() => loadConversations())
      .catch(() => undefined);
  };

  const changeReception = (
    state: 'human' | 'avatar',
    strategy: ReceptionStrategy,
    tempHours?: number,
  ) => {
    if (!convId) return;
    setModeSheetOpen(false);
    void api
      .updateReception(convId, {
        state,
        strategy,
        until: tempHours ? new Date(Date.now() + tempHours * 3600_000).toISOString() : null,
      })
      .then(() => loadConversations())
      .catch(() => undefined);
  };

  const release = () => {
    if (!convId) return;
    setModeSheetOpen(false);
    void api
      .release(convId)
      .then(() => loadConversations())
      .catch(() => undefined);
  };

  const isGroupChat = Boolean(
    view && view.conversation.type === 'group' && view.conversation.systemTag === null,
  );
  const now = Date.now();
  const activeTypers = Object.entries(typingByConv[convId] ?? {}).filter(
    ([pid, until]) => pid !== myId && until > now,
  );
  const typingNames = activeTypers.map(
    ([pid]) => members.find((m) => m.principalId === pid)?.name ?? '成员',
  );
  // 分身正在处理：把发送按钮切换为停止/接管
  const avatarTyping = activeTypers.some(
    ([pid]) => members.find((m) => m.principalId === pid)?.principalType === 'avatar',
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ChatHeader
        view={view}
        members={members}
        onBack={() => router.back()}
        onModePress={() => setModeSheetOpen(true)}
        onMembersPress={() => setMemberSheetOpen(true)}
      />

      <FlatList
        ref={listRef}
        data={listData}
        keyExtractor={(item) =>
          item.kind === 'pending' ? `p_${item.pending.clientMsgId}` : item.message.msgId
        }
        renderItem={({ item }) => {
          if (item.kind === 'pending') {
            return <PendingMessageBubble pending={item.pending} />;
          }
          return (
            <MessageBubble
              message={item.message}
              members={members}
              myId={myId}
              onCardAction={onCardAction}
              onReply={(msgId, preview) => setReplyTo({ msgId, preview })}
            />
          );
        }}
        contentContainerStyle={{ paddingVertical: 10 }}
        onContentSizeChange={() => {
          // 流式正文/工具活动/思考收起都会改变内容高度：在底部时持续贴底
          if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          if (contentOffset.y < 40) void loadMore();
          const distance = contentSize.height - contentOffset.y - layoutMeasurement.height;
          const nearBottom = distance < 80;
          atBottomRef.current = nearBottom;
          if (nearBottom) setShowJump(false);
        }}
        scrollEventThrottle={80}
        ListHeaderComponent={
          loadingMore ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text variant="micro" tone="muted">
                加载更早消息…
              </Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Text variant="bodySm" tone="muted">
              还没有消息，打个招呼吧
            </Text>
          </View>
        }
      />

      {showJump ? (
        <View style={{ alignItems: 'center', paddingVertical: 4 }}>
          <Button
            size="sm"
            variant="secondary"
            fullWidth={false}
            icon="arrow-down-line"
            label="回到最新"
            onPress={() => {
              atBottomRef.current = true;
              setShowJump(false);
              listRef.current?.scrollToEnd({ animated: true });
            }}
          />
        </View>
      ) : null}

      {/* 正在输入 / 分身处理中：仅在实际发生时占位，空闲时不留下灰色空条 */}
      {typingNames.length > 0 ? (
        <View
          style={{
            height: 24,
            paddingHorizontal: 16,
            justifyContent: 'center',
            backgroundColor: t.card,
          }}
        >
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {avatarTyping ? '分身正在处理…' : `${typingNames.join('、')} 正在输入…`}
          </Text>
        </View>
      ) : null}

      <ChatComposer
        convId={convId}
        members={members}
        myId={myId}
        isGroup={isGroupChat}
        avatarTyping={avatarTyping}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onTakeover={takeover}
      />

      {view ? (
        <MemberSheet
          visible={memberSheetOpen}
          onClose={() => setMemberSheetOpen(false)}
          convId={convId}
          view={view}
          members={members}
          onLeft={() => router.back()}
        />
      ) : null}

      <ReceptionSheet
        visible={modeSheetOpen}
        onClose={() => setModeSheetOpen(false)}
        view={view}
        onChangeReception={changeReception}
        onTakeover={takeover}
        onRelease={release}
      />
    </KeyboardAvoidingView>
  );
}
