import { ALL_MENTION_ID, type Content } from '@chappie/contract';
import { adminApi, dayjs, type MemberView, useChatStore } from '@chappie/shared';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type TextInput,
  type TextStyle,
  View,
} from 'react-native';
import Icon from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';
import { realtime } from '@/realtime';
import { Avatar, Badge, Button, IconButton, Input, Text } from '@/ui';

export type ReplyTarget = { msgId: string; preview: string };

type AttachmentDraft = {
  uri: string;
  name: string;
  type: string;
  isImage: boolean;
  width?: number;
  height?: number;
  size?: number;
};

type MentionOption = {
  principalId: string;
  name: string;
  kind: 'human' | 'avatar' | 'all';
};

function newClientId(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * 会话输入区：文本 / 附件 / @ 提及 / 回复 / 发送状态。
 *
 * 自己持有输入草稿；发送时直接写入 store 的 pending 队列并经 WS 提交。
 * 页面只负责会话数据、消息列表和接待方式。
 */
export function ChatComposer({
  convId,
  members,
  myId,
  isGroup,
  avatarTyping,
  replyTo,
  onClearReply,
  onTakeover,
}: {
  convId: string;
  members: MemberView[];
  myId: string;
  isGroup: boolean;
  avatarTyping: boolean;
  replyTo: ReplyTarget | null;
  onClearReply: () => void;
  onTakeover: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const addPending = useChatStore((s) => s.addPending);
  const updatePending = useChatStore((s) => s.updatePending);
  const removePending = useChatStore((s) => s.removePending);

  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** 输入内容超过一行后切换为「上方文本 + 下方操作行」的多行卡片 */
  const [multilineLayout, setMultilineLayout] = useState(false);
  const [inputContentHeight, setInputContentHeight] = useState(0);
  /** @ 提及：候选面板 / 输入中的查询 / 需要替换的文本区间 */
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [caretOverride, setCaretOverride] = useState<{ start: number; end: number } | null>(null);

  const caretRef = useRef({ start: 0, end: 0 });
  /** 同步保存最新文本：selection 事件可能早于 state 重渲染，避免用旧文本判断 @ 查询 */
  const textRef = useRef('');
  const composerRef = useRef<ComponentRef<typeof TextInput>>(null);
  /** 同步发送锁：state 更新前拦住连点 */
  const sendingRef = useRef(false);
  const lastSentAtRef = useRef(0);

  // 多行布局：显式换行或输入内容撑高后切换；清空后回到单行胶囊。
  // 一旦切到多行就保持到清空，避免列宽变化导致行数抖动。
  useEffect(() => {
    if (text.length === 0) {
      setMultilineLayout(false);
      setInputContentHeight(0);
      return;
    }
    if (text.includes('\n') || inputContentHeight > 46) setMultilineLayout(true);
  }, [text, inputContentHeight]);

  // 用户在正文里删掉 @名字 后，同步移除对应的提及 ID，避免发出“看不见的提及”
  useEffect(() => {
    if (mentions.length === 0) return;
    setMentions((prev) => {
      const next = prev.filter((id) => {
        if (id === ALL_MENTION_ID) return text.includes('@所有人');
        const member = members.find((m) => m.principalId === id);
        return member ? text.includes(`@${member.name}`) : true;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [text, members, mentions.length]);

  const mentionCandidates = members.filter((m) => m.principalId !== myId);
  const mentionOptions: MentionOption[] = [
    ...(isGroup ? [{ principalId: ALL_MENTION_ID, name: '所有人', kind: 'all' as const }] : []),
    ...mentionCandidates.map((m) => ({
      principalId: m.principalId,
      name: m.name,
      kind: m.principalType === 'avatar' ? ('avatar' as const) : ('human' as const),
    })),
  ].filter((o) => {
    const q = mentionQuery.trim().toLowerCase();
    return !q || o.name.toLowerCase().includes(q);
  });

  const applyCaret = (pos: number) => {
    caretRef.current = { start: pos, end: pos };
    setCaretOverride({ start: pos, end: pos });
    setTimeout(() => setCaretOverride(null), 50);
  };

  const closeMention = () => {
    setMentionOpen(false);
    setMentionRange(null);
    setMentionQuery('');
  };

  /** 从光标前的文本判断是否处于「@ + 查询」状态 */
  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    // 紧跟在英文/数字后（如邮箱 user@domain）不当作提及；中文与标点后允许
    if (at < 0 || (at > 0 && /[A-Za-z0-9_%+-]/.test(value[at - 1] ?? ''))) {
      if (mentionOpen) closeMention();
      return;
    }
    const query = value.slice(at + 1, caret);
    if (/\s/.test(query)) {
      if (mentionOpen) closeMention();
      return;
    }
    setMentionRange({ start: at, end: caret });
    setMentionQuery(query);
    setMentionOpen(true);
  };

  const insertMention = (option: MentionOption) => {
    const current = textRef.current;
    const range = mentionRange;
    const start = Math.min(range ? range.start : caretRef.current.start, current.length);
    const end = range ? Math.min(range.end, current.length) : start;
    const token = `@${option.name} `;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    const nextCaret = start + token.length;
    textRef.current = next;
    setText(next);
    setMentions((prev) =>
      prev.includes(option.principalId) ? prev : [...prev, option.principalId],
    );
    closeMention();
    setAttachOpen(false);
    applyCaret(nextCaret);
    composerRef.current?.focus();
  };

  const uploadOne = async (att: AttachmentDraft): Promise<Content> => {
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
    textRef.current = '';
    setText('');
    setMentions([]);
    setAttachments([]);
    setAttachOpen(false);
    setMentionOpen(false);
    setMentionRange(null);
    setMentionQuery('');
    onClearReply();

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

  const composerPlus = (
    <IconButton
      icon="add-line"
      label={attachOpen ? '收起附件菜单' : '添加附件'}
      size={40}
      tone={attachOpen ? 'primary' : 'default'}
      disabled={uploading}
      onPress={() => {
        setAttachOpen((v) => !v);
        setMentionOpen(false);
      }}
    />
  );
  const composerSend = uploading ? (
    <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="small" color={t.primary} />
    </View>
  ) : avatarTyping ? (
    <IconButton
      icon="stop-circle-line"
      label="停止分身并接管"
      size={40}
      tone="danger"
      solid
      onPress={onTakeover}
    />
  ) : (
    <IconButton
      icon="send-plane-fill"
      label="发送"
      size={40}
      tone="primary"
      solid
      disabled={!text.trim() && attachments.length === 0}
      onPress={() => void send()}
    />
  );
  const composerInput = (
    <Input
      ref={composerRef}
      value={text}
      selection={caretOverride ?? undefined}
      onChangeText={(v) => {
        textRef.current = v;
        setText(v);
        realtime()?.typing(convId);
        detectMention(v, v.length);
      }}
      onSelectionChange={(e) => {
        caretRef.current = e.nativeEvent.selection;
        detectMention(textRef.current, e.nativeEvent.selection.start);
      }}
      onFocus={() => setAttachOpen(false)}
      onContentSizeChange={(e) => setInputContentHeight(e.nativeEvent.contentSize.height)}
      placeholder="输入消息…"
      multiline
      // Web 单行时 textarea 默认两行高，会把文字顶到顶部；多行时放开
      numberOfLines={Platform.OS === 'web' && !multilineLayout ? 1 : undefined}
      underlineColorAndroid="transparent"
      style={[
        {
          borderWidth: 0,
          backgroundColor: t.bg,
          maxHeight: 110,
          fontSize: 15,
          outlineWidth: 0,
          outlineStyle: 'solid',
          outlineColor: 'transparent',
        },
        multilineLayout
          ? {
              alignSelf: 'stretch',
              minHeight: 48,
              paddingHorizontal: 8,
              paddingTop: 8,
              paddingBottom: 4,
              textAlignVertical: 'top',
            }
          : {
              flex: 1,
              minHeight: 40,
              paddingHorizontal: 2,
              paddingVertical: 10,
              textAlignVertical: 'center',
            },
        // outline-style: auto 时光设宽度无效，Web 需显式置为 none
        Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null,
      ]}
    />
  );

  return (
    <View
      style={{
        backgroundColor: t.card,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 10),
      }}
    >
      {replyTo ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: t.surfaceRaised,
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
            onPress={onClearReply}
          />
        </View>
      ) : null}
      {attachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
        >
          {attachments.map((att, index) => (
            <View
              key={`${att.uri}-${att.name}`}
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

      {/* 「+」展开的附件入口：避免输入框两侧堆图标 */}
      {attachOpen ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 8, paddingHorizontal: 2 }}>
          <Button
            size="sm"
            variant="secondary"
            fullWidth={false}
            icon="image-line"
            label="图片"
            onPress={() => {
              setAttachOpen(false);
              void pickImage();
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            fullWidth={false}
            icon="attachment-2"
            label="文件"
            onPress={() => {
              setAttachOpen(false);
              void pickFile();
            }}
          />
        </View>
      ) : null}

      {/* @ 提及候选：贴在输入卡上方，避免遮挡正文 */}
      {mentionOpen ? (
        <View
          style={{
            marginBottom: 8,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.separator,
            backgroundColor: t.card,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 12,
              paddingRight: 4,
              paddingVertical: 2,
            }}
          >
            <Text variant="micro" tone="muted">
              提及成员
            </Text>
            <IconButton
              icon="close-line"
              label="关闭提及"
              size={28}
              tone="muted"
              onPress={closeMention}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
            {mentionOptions.length === 0 ? (
              <Text
                variant="caption"
                tone="muted"
                style={{ paddingHorizontal: 12, paddingVertical: 12 }}
              >
                没有匹配的成员
              </Text>
            ) : (
              mentionOptions.map((option) => (
                <Pressable
                  key={option.principalId}
                  accessibilityRole="button"
                  accessibilityLabel={`提及 ${option.name}`}
                  onPress={() => insertMention(option)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    backgroundColor: pressed ? t.surfaceHover : 'transparent',
                  })}
                >
                  {option.kind === 'all' ? (
                    <Avatar name="所有人" variant="group" size={28} />
                  ) : (
                    <Avatar
                      name={option.name}
                      variant={option.kind === 'avatar' ? 'avatar' : 'human'}
                      size={28}
                    />
                  )}
                  <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {option.name}
                  </Text>
                  {option.kind === 'avatar' ? <Badge label="AI" tone="ai" /> : null}
                  {option.kind === 'all' ? <Badge label="广播" tone="brand" /> : null}
                  {mentions.includes(option.principalId) ? (
                    <Icon name="check-line" size={16} color={t.primary} />
                  ) : null}
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: multilineLayout ? 'column' : 'row',
          alignItems: multilineLayout ? 'stretch' : 'center',
          gap: multilineLayout ? 2 : 4,
          padding: 4,
          borderRadius: 24,
          backgroundColor: t.bg,
        }}
      >
        {multilineLayout ? null : composerPlus}
        {composerInput}
        {multilineLayout ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 2,
            }}
          >
            {composerPlus}
            {composerSend}
          </View>
        ) : (
          composerSend
        )}
      </View>
    </View>
  );
}
