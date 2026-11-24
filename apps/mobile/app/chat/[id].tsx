import { type Content, contentText } from '@chappie/contract';
import {
  adminApi,
  api,
  dayjs,
  formatTime,
  type Message,
  type PendingMessage,
  RECEPTION_LABELS,
  type ReceptionStrategy,
  STRATEGY_LABELS,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MemberSheet } from '@/components/member-sheet';
import { type CardAction, MessageBubble } from '@/components/message';
import { useTheme } from '@/hooks/use-theme';
import { realtime } from '@/realtime';
import { modeLabels } from '@/theme';
import { Badge, BottomSheet, Button, Chip, IconButton, Input, Text } from '@/ui';

function newClientId(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const STRATEGIES: ReceptionStrategy[] = [
  'summon',
  'assist',
  'full',
  'screen',
  'decline',
  'escalate',
  'silent',
];

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
  const typingByConv = useChatStore((s) => s.typingByConv);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const loadMembers = useChatStore((s) => s.loadMembers);
  const setActiveConv = useChatStore((s) => s.setActiveConv);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const addPending = useChatStore((s) => s.addPending);
  const updatePending = useChatStore((s) => s.updatePending);
  const removePending = useChatStore((s) => s.removePending);
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
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [modeSheetOpen, setModeSheetOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ msgId: string; preview: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** 同步发送锁：state 更新前拦住连点 */
  const sendingRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const [attachments, setAttachments] = useState<
    Array<{
      uri: string;
      name: string;
      type: string;
      isImage: boolean;
      width?: number;
      height?: number;
      size?: number;
    }>
  >([]);
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

  const uploadOne = async (att: {
    uri: string;
    name: string;
    type: string;
    isImage: boolean;
    width?: number;
    height?: number;
    size?: number;
  }): Promise<Content> => {
    const { file: info, url } = await adminApi.uploadFile(
      { uri: att.uri, name: att.name, type: att.type },
      att.name,
    );
    return info.mime.startsWith('image/')
      ? {
          type: 'image',
          schemaVersion: 1,
          url,
          name: info.name,
          ...(att.width ? { width: att.width } : {}),
          ...(att.height ? { height: att.height } : {}),
        }
      : {
          type: 'file',
          schemaVersion: 1,
          url,
          name: info.name,
          ...(info.size ? { size: info.size } : {}),
        };
  };

  const send = async () => {
    // 同步锁 + 短冷却：拦截连点等重复提交
    if (sendingRef.current || Date.now() - lastSentAtRef.current < 600) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    if (!convId) return;
    const ws = realtime();
    if (!ws?.isOpen) {
      Alert.alert('连接未就绪', '正在重新连接，请稍候再试');
      return;
    }
    sendingRef.current = true;
    lastSentAtRef.current = Date.now();
    setUploading(true);

    const batch = [...attachments];
    const batchIds = batch.map(() => newClientId());
    const textId = value ? newClientId() : null;
    const createdAt = dayjs().toISOString();
    const replyToId = replyTo?.msgId ?? null;

    // 1) 立即上屏：图片用本地预览，文本同时显示
    batch.forEach((att, i) => {
      const content: Content = att.isImage
        ? {
            type: 'image',
            schemaVersion: 1,
            url: att.uri,
            name: att.name,
            ...(att.width ? { width: att.width } : {}),
            ...(att.height ? { height: att.height } : {}),
          }
        : {
            type: 'file',
            schemaVersion: 1,
            url: '',
            name: att.name,
            ...(att.size ? { size: att.size } : {}),
          };
      addPending({
        clientMsgId: batchIds[i]!,
        convId,
        content,
        mentions: [],
        replyTo: replyToId,
        createdAt,
        status: 'uploading',
      });
    });
    if (value && textId) {
      addPending({
        clientMsgId: textId,
        convId,
        content: { type: 'text', schemaVersion: 1, text: value },
        mentions,
        replyTo: replyToId,
        createdAt,
        status: 'sending',
      });
    }
    setText('');
    setMentions([]);
    setReplyTo(null);
    setAttachments([]);

    const uploaded: { clientMsgId: string; content: Content }[] = [];
    const failed: string[] = [];
    try {
      // 2) 异步上传；完成后只更新 pending，不立即发 WS
      for (let i = 0; i < batch.length; i++) {
        const att = batch[i]!;
        const clientMsgId = batchIds[i]!;
        try {
          const content = await uploadOne(att);
          updatePending(convId, clientMsgId, { content, status: 'sending' });
          uploaded.push({ clientMsgId, content });
        } catch {
          removePending(convId, clientMsgId);
          failed.push(att.name);
          setAttachments((prev) => [...prev, att]);
        }
      }

      // 3) 全部上传完成后快速提交，附件+文本落在同一个 AI 合并窗口内
      for (const item of uploaded) {
        ws.sendMessage(convId, item.content, {
          clientMsgId: item.clientMsgId,
          mentions: [],
          replyTo: replyToId,
        });
      }
      if (value && textId) {
        ws.sendMessage(
          convId,
          { type: 'text', schemaVersion: 1, text: value },
          { clientMsgId: textId, mentions, replyTo: replyToId },
        );
      }
      if (failed.length > 0) {
        Alert.alert('部分附件上传失败', failed.join('、'));
      }
    } catch (e) {
      Alert.alert('发送失败', e instanceof Error ? e.message : String(e));
    } finally {
      sendingRef.current = false;
      setUploading(false);
    }
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要相册权限', '请在系统设置中允许访问照片');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
    });
    if (res.canceled) return;
    setAttachments((prev) => [
      ...prev,
      ...res.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.fileName ?? `image-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
        isImage: true,
        width: asset.width,
        height: asset.height,
        size: asset.fileSize,
      })),
    ]);
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/*', 'application/json', 'application/zip'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    setAttachments((prev) => [
      ...prev,
      ...res.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
        isImage: (asset.mimeType ?? '').startsWith('image/'),
        size: asset.size,
      })),
    ]);
  };

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

  const mentionCandidates = members.filter((m) => m.principalId !== myId);
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
      {/* 头部 */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 8,
          paddingHorizontal: 8,
          backgroundColor: t.card,
          borderBottomWidth: 1,
          borderBottomColor: t.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <IconButton
          icon="arrow-left-s-line"
          label="返回"
          tone="primary"
          onPress={() => router.back()}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
              {view?.displayTitle ?? '会话'}
            </Text>
            {view?.conversation.systemTag === 'avatar_self' ? (
              <Badge label="分身" tone="ai" />
            ) : null}
          </View>
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {view?.conversation.systemTag === 'avatar_self'
              ? '与分身直接对话，无需切换接待身份'
              : view?.conversation.type === 'group'
                ? `${members.filter((m) => m.principalType === 'human').length} 位成员 · ${
                    members.filter((m) => m.principalType === 'avatar').length
                  } 个分身`
                : view?.peerReception?.state === 'avatar'
                  ? '对方由 AI 分身接待'
                  : '对方当前为真人接待'}
          </Text>
        </View>
        {view?.conversation.systemTag === 'avatar_self' ? (
          <Badge label="控制通道" tone="ai" />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            fullWidth={false}
            label={`${
              view?.myReception
                ? RECEPTION_LABELS[view.myReception.state]
                : modeLabels[view?.myAiMode ?? 'manual']
            }${
              view?.myReception?.state === 'avatar'
                ? ` · ${STRATEGY_LABELS[view.myReception.strategy] ?? ''}`
                : ''
            }${view?.myReception?.until ? ' · 临时' : ''}`}
            onPress={() => setModeSheetOpen(true)}
          />
        )}
        {view && view.conversation.type === 'group' && view.conversation.systemTag === null ? (
          <IconButton icon="team-line" label="成员管理" onPress={() => setMemberSheetOpen(true)} />
        ) : null}
      </View>

      <FlatList
        ref={listRef}
        data={listData}
        keyExtractor={(item) =>
          item.kind === 'pending' ? `p_${item.pending.clientMsgId}` : item.message.msgId
        }
        renderItem={({ item }) => {
          if (item.kind === 'pending') {
            const pc = item.pending.content;
            const uploading = item.pending.status === 'uploading';
            return (
              <View
                style={{
                  alignItems: 'flex-end',
                  paddingHorizontal: 14,
                  paddingVertical: 5,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    marginBottom: 3,
                  }}
                >
                  <Text variant="micro" tone="muted">
                    我 · {formatTime(item.pending.createdAt)} · {uploading ? '上传中' : '发送中'}
                  </Text>
                  <ActivityIndicator size="small" color={t.textMuted} />
                </View>
                {pc.type === 'image' ? (
                  <View
                    style={{
                      position: 'relative',
                      borderRadius: 16,
                      overflow: 'hidden',
                      backgroundColor: t.surfaceRaised,
                    }}
                  >
                    {pc.url ? (
                      <Image
                        source={{ uri: pc.url }}
                        style={{
                          width: 220,
                          height:
                            pc.width && pc.height
                              ? Math.min(280, Math.round((220 * pc.height) / pc.width))
                              : 160,
                          opacity: uploading ? 0.7 : 1,
                        }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={{
                          width: 220,
                          height: 160,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <ActivityIndicator color={t.primary} />
                      </View>
                    )}
                    {uploading ? (
                      <View
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'rgba(0,0,0,0.25)',
                        }}
                      >
                        <ActivityIndicator color="#fff" />
                      </View>
                    ) : null}
                  </View>
                ) : pc.type === 'file' ? (
                  <View
                    style={{
                      width: 260,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      borderRadius: 12,
                      backgroundColor: t.primary,
                      padding: 10,
                    }}
                  >
                    <Icon name="file-text-line" size={20} color={t.primaryFg} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        variant="caption"
                        numberOfLines={1}
                        style={{ color: t.primaryFg, fontWeight: '600' }}
                      >
                        {pc.name ?? '文件'}
                      </Text>
                      {typeof pc.size === 'number' ? (
                        <Text variant="micro" style={{ color: t.primaryFg, opacity: 0.8 }}>
                          {formatBytes(pc.size)}
                        </Text>
                      ) : null}
                    </View>
                    {uploading ? <ActivityIndicator color={t.primaryFg} /> : null}
                  </View>
                ) : (
                  <View
                    style={{
                      backgroundColor: t.primary,
                      borderRadius: 16,
                      paddingHorizontal: 13,
                      paddingVertical: 9,
                      maxWidth: '82%',
                    }}
                  >
                    <Text style={{ fontSize: 15, color: t.primaryFg }}>{contentText(pc)}</Text>
                  </View>
                )}
              </View>
            );
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

      {/* 提及候选 */}
      {mentionCandidates.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ maxHeight: 42, borderTopWidth: 1, borderTopColor: t.border }}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 6, gap: 6 }}
        >
          {mentionCandidates.map((m) => (
            <Chip
              key={m.principalId}
              label={`@${m.name}${m.principalType === 'avatar' ? ' ✨' : ''}`}
              active={mentions.includes(m.principalId)}
              onPress={() =>
                setMentions((prev) =>
                  prev.includes(m.principalId)
                    ? prev.filter((x) => x !== m.principalId)
                    : [...prev, m.principalId],
                )
              }
            />
          ))}
        </ScrollView>
      ) : null}

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

      {/* 正在输入 / 分身处理中：固定高度占位，消失时高度不变 */}
      <View
        style={{
          height: 24,
          paddingHorizontal: 16,
          justifyContent: 'center',
          opacity: typingNames.length > 0 ? 1 : 0,
        }}
        pointerEvents={typingNames.length > 0 ? 'auto' : 'none'}
      >
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {typingNames.length > 0
            ? avatarTyping
              ? '分身正在处理…'
              : `${typingNames.join('、')} 正在输入…`
            : ' '}
        </Text>
      </View>

      {/* 输入栏 */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: t.border,
          backgroundColor: t.card,
          paddingBottom: Math.max(insets.bottom, 10),
        }}
      >
        {replyTo ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginHorizontal: 12,
              marginTop: 8,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 8,
              backgroundColor: t.bg,
              borderLeftWidth: 2,
              borderLeftColor: t.primary,
            }}
          >
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              回复:{replyTo.preview}
            </Text>
            <IconButton
              icon="close-line"
              label="取消回复"
              size={28}
              tone="muted"
              onPress={() => setReplyTo(null)}
            />
          </View>
        ) : null}
        {attachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 8 }}
          >
            {attachments.map((att, index) => (
              <View
                key={`${att.name}-${index}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: t.surfaceRaised,
                  borderRadius: 10,
                  padding: 4,
                }}
              >
                {att.isImage ? (
                  <Image
                    source={{ uri: att.uri }}
                    style={{ width: 34, height: 34, borderRadius: 6 }}
                  />
                ) : (
                  <Icon name="file-text-line" size={16} color={t.textMuted} />
                )}
                <Text variant="micro" tone="muted" numberOfLines={1} style={{ maxWidth: 110 }}>
                  {att.name}
                </Text>
                <IconButton
                  icon="close-line"
                  label="移除附件"
                  size={24}
                  tone="muted"
                  onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                />
              </View>
            ))}
          </ScrollView>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            paddingHorizontal: 12,
            paddingTop: 8,
          }}
        >
          <IconButton
            icon="image-line"
            label="发送图片"
            size={36}
            tone="muted"
            disabled={uploading}
            onPress={() => void pickImage()}
          />
          <IconButton
            icon="attachment-2"
            label="发送文件"
            size={36}
            tone="muted"
            disabled={uploading}
            onPress={() => void pickFile()}
          />
          {uploading ? <ActivityIndicator size="small" color={t.primary} /> : null}
          <Input
            value={text}
            onChangeText={(v) => {
              setText(v);
              realtime()?.typing(convId);
            }}
            placeholder="输入消息…"
            multiline
            style={{ flex: 1, maxHeight: 110, borderRadius: 22, paddingVertical: 9 }}
          />
          {avatarTyping ? (
            <IconButton
              icon="stop-circle-line"
              label="停止分身并接管"
              size={44}
              tone="danger"
              filled
              onPress={takeover}
            />
          ) : (
            <IconButton
              icon="send-plane-fill"
              label="发送"
              size={44}
              tone="primary"
              filled
              disabled={(!text.trim() && attachments.length === 0) || uploading}
              onPress={() => void send()}
            />
          )}
        </View>
      </View>

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

      {/* 接待权选择（真人/分身 + 策略 + 临时托管） */}
      <BottomSheet
        visible={modeSheetOpen}
        onClose={() => setModeSheetOpen(false)}
        title="接待方式"
        description="真人接待时分身只在你召唤或确认草稿时协助；临时托管到期自动回落。"
      >
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Button
            size="sm"
            variant={view?.myReception?.state !== 'avatar' ? 'primary' : 'outline'}
            label="真人接待"
            onPress={() => changeReception('human', view?.myReception?.strategy ?? 'assist')}
            style={{ flex: 1 }}
          />
          <Button
            size="sm"
            variant={view?.myReception?.state === 'avatar' ? 'primary' : 'outline'}
            label="分身接待"
            onPress={() => release()}
            style={{ flex: 1 }}
          />
        </View>
        <Text variant="micro" tone="muted" style={{ marginTop: 14 }}>
          分身策略
        </Text>
        {STRATEGIES.map((s) => {
          const active = view?.myReception?.strategy === s;
          return (
            <View
              key={s}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}
            >
              <Button
                size="sm"
                variant={active ? 'primary' : 'outline'}
                label={`${STRATEGY_LABELS[s] ?? s}${active ? '（当前）' : ''}`}
                onPress={() => changeReception('avatar', s)}
                style={{ flex: 1 }}
              />
              <Button
                size="sm"
                variant="outline"
                fullWidth={false}
                label="临时 2h"
                onPress={() => changeReception('avatar', s, 2)}
              />
            </View>
          );
        })}
        <Button
          variant="outline"
          tone="warning"
          label="接管对话（暂停分身并冷却 15 分钟）"
          onPress={takeover}
          style={{ marginTop: 14 }}
        />
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
