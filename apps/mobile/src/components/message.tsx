import { contentText } from '@chappie/contract';
import type { CardPayload, MemberView, Message } from '@chappie/shared';
import { api, formatTime, resolveAttachmentUrl, stripToolCallMarkup } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { realtime } from '@/realtime';
import { Avatar, Badge, BottomSheet, Button, Card, Dialog, Input, MenuRow, Text } from '@/ui';
import { AgentActivityPanel } from './agent-activity';

export type CardAction =
  | 'send'
  | 'edit'
  | 'discard'
  | 'approve'
  | 'modify_approve'
  | 'reject'
  | 'cancel'
  | 'grant_human'
  | 'decline_human';

export function MessageBubble({
  message,
  members,
  myId,
  onCardAction,
  onReply,
}: {
  message: Message;
  members: MemberView[];
  myId: string;
  onCardAction: (msgId: string, action: CardAction, editedText?: string) => void;
  onReply?: (msgId: string, preview: string) => void;
}) {
  const t = useTheme();
  const mine = message.senderId === myId;
  const isAvatar = message.senderType === 'avatar';
  const sender = members.find((m) => m.principalId === message.senderId);
  const [showExplain, setShowExplain] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctText, setCorrectText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  if (message.content.type === 'card') {
    return (
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 5,
          alignItems: mine ? 'flex-end' : 'flex-start',
        }}
      >
        <CardView card={message.content.card} msgId={message.msgId} onAction={onCardAction} />
      </View>
    );
  }

  const rawText = message.recalled
    ? '消息已撤回'
    : message.content.type === 'text'
      ? message.content.text
      : contentText(message.content);
  // 历史消息可能已把文本形式的 <tool_call> 落库：渲染时兜底剥离
  const text = isAvatar ? stripToolCallMarkup(rawText) : rawText;
  const media =
    !message.recalled && (message.content.type === 'image' || message.content.type === 'file')
      ? message.content
      : null;
  const imageHeight =
    media?.type === 'image' && media.width && media.height
      ? Math.min(280, Math.round((220 * media.height) / media.width))
      : 160;
  const canRecall = !message.recalled && (mine || message.onBehalfOf === myId);

  const feedback = (type: 'like' | 'report') => {
    void api
      .feedback(message.msgId, { type })
      .then(() => setNotice(type === 'like' ? '已点赞' : '已举报'))
      .catch(() => setNotice('反馈失败'));
  };

  return (
    <>
      <MessageRow mine={mine} wide={isAvatar}>
        <MessageIdentity
          mine={mine}
          senderName={sender?.name}
          senderType={isAvatar ? 'avatar' : 'human'}
          senderAvatarName={sender?.name}
          onBehalfOfMe={isAvatar && message.onBehalfOf === myId}
          createdAt={message.createdAt}
        />
        <AgentActivityPanel
          thinking={message.recalled ? '' : (message.aiMeta?.thinking ?? '')}
          activity={message.aiMeta?.activity ?? []}
          streaming={Boolean(message.aiMeta?.streaming) && !message.recalled}
        />
        {media ? (
          media.type === 'image' ? (
            <Pressable
              onPress={() => void Linking.openURL(resolveAttachmentUrl(media.url))}
              onLongPress={() => setSheetOpen(true)}
            >
              <Image
                source={{ uri: resolveAttachmentUrl(media.url) }}
                style={{ width: 220, height: imageHeight, borderRadius: 14 }}
                resizeMode="cover"
              />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void Linking.openURL(resolveAttachmentUrl(media.url))}
              onLongPress={() => setSheetOpen(true)}
              style={{
                width: 260,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderRadius: 12,
                backgroundColor: mine ? t.bubbleUser : isAvatar ? t.surfaceRaised : t.bubble,
                padding: 10,
              }}
            >
              <Icon name="file-text-line" size={20} color={mine ? t.bubbleUserText : t.textMuted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  variant="caption"
                  numberOfLines={1}
                  style={{ fontWeight: '600', color: mine ? t.bubbleUserText : t.text }}
                >
                  {media.name}
                </Text>
                {typeof media.size === 'number' ? (
                  <Text variant="micro" style={{ color: mine ? t.bubbleUserText : t.textMuted }}>
                    {formatBytes(media.size)}
                  </Text>
                ) : null}
              </View>
              <Icon name="download-line" size={16} color={mine ? t.bubbleUserText : t.textMuted} />
            </Pressable>
          )
        ) : text ? (
          <MessageSurface
            mine={mine}
            isAvatar={isAvatar}
            recalled={message.recalled}
            text={text}
            streaming={Boolean(message.aiMeta?.streaming) && !message.recalled}
            onPress={
              isAvatar && message.aiMeta?.explanation ? () => setShowExplain((v) => !v) : undefined
            }
            onLongPress={message.recalled ? undefined : () => setSheetOpen(true)}
            accessibilityLabel={`${mine ? '我' : (sender?.name ?? '成员')}：${text}`}
          />
        ) : null}
        {notice ? (
          <Text variant="micro" tone="success" style={{ marginTop: 2 }}>
            {notice}
          </Text>
        ) : null}
        {isAvatar && showExplain && message.aiMeta?.explanation ? (
          <Card padding={9} style={{ marginTop: 5 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                marginBottom: 3,
              }}
            >
              <Icon name="magic-line" size={12} color={t.primary} />
              <Text variant="micro" tone="primary" style={{ fontWeight: '600' }}>
                为什么这么回
              </Text>
            </View>
            <Text variant="micro" tone="muted" style={{ lineHeight: 16 }}>
              {message.aiMeta.explanation.reason}
            </Text>
            <Text variant="micro" tone="muted" style={{ marginTop: 4 }}>
              置信度 {(message.aiMeta.explanation.confidence * 100).toFixed(0)}%
              {message.aiMeta.explanation.toolsUsed.length > 0
                ? ` · 工具 ${message.aiMeta.explanation.toolsUsed.join('、')}`
                : ''}
            </Text>
          </Card>
        ) : null}
      </MessageRow>

      {/* 长按操作面板 */}
      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginBottom: 6 }}>
          {text.slice(0, 40)}
        </Text>
        <MenuRow
          icon="reply-line"
          label="回复"
          onPress={() => {
            onReply?.(message.msgId, text.slice(0, 60));
            setSheetOpen(false);
          }}
        />
        {isAvatar ? (
          <>
            <MenuRow
              icon="thumb-up-line"
              label="点赞"
              onPress={() => {
                setSheetOpen(false);
                feedback('like');
              }}
            />
            <MenuRow
              icon="magic-line"
              label="纠正回复"
              onPress={() => {
                setSheetOpen(false);
                setCorrectOpen(true);
              }}
            />
            <MenuRow
              icon="flag-line"
              label="举报"
              onPress={() => {
                setSheetOpen(false);
                feedback('report');
              }}
            />
          </>
        ) : null}
        {canRecall ? (
          <MenuRow
            icon="arrow-go-back-line"
            label="撤回消息"
            tone="danger"
            onPress={() => {
              realtime()?.recall(message.msgId);
              setSheetOpen(false);
              setNotice('已请求撤回');
            }}
          />
        ) : null}
      </BottomSheet>

      {/* 纠正回复 */}
      <Dialog visible={correctOpen} onClose={() => setCorrectOpen(false)} title="纠正分身的回复">
        <Text variant="micro" tone="muted" style={{ marginBottom: 8 }} numberOfLines={3}>
          原回复:{text.slice(0, 120)}
        </Text>
        <Input
          value={correctText}
          onChangeText={setCorrectText}
          multiline
          minHeight={80}
          placeholder="你希望它怎么回？（这条纠正会进入偏好学习）"
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button
            label="提交纠正"
            disabled={!correctText.trim()}
            onPress={() => {
              void api
                .feedback(message.msgId, {
                  type: 'correct',
                  correctedText: correctText.trim(),
                })
                .then(() => {
                  setCorrectOpen(false);
                  setCorrectText('');
                  setNotice('已记录纠正');
                })
                .catch(() => setNotice('提交失败'));
            }}
            style={{ flex: 1 }}
          />
          <Button
            label="取消"
            variant="ghost"
            fullWidth={false}
            onPress={() => setCorrectOpen(false)}
          />
        </View>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// 消息解剖：行（对齐）→ 身份（谁/代发）→ 气泡表面（内容）→ 附属动作
// 参考 beUI：气泡只负责阅读形状，不承担身份与滚动语义。
// ---------------------------------------------------------------------------

function MessageRow({
  mine,
  wide,
  children,
}: {
  mine: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 5,
        alignItems: mine ? 'flex-end' : 'flex-start',
      }}
    >
      <View style={wide ? { width: '100%' } : { maxWidth: '82%' }}>{children}</View>
    </View>
  );
}

function MessageIdentity({
  mine,
  senderName,
  senderType,
  senderAvatarName,
  onBehalfOfMe,
  createdAt,
}: {
  mine: boolean;
  senderName?: string;
  senderType: 'human' | 'avatar';
  senderAvatarName?: string;
  onBehalfOfMe: boolean;
  createdAt: string;
}) {
  const isAvatar = senderType === 'avatar';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
      {!mine && senderAvatarName ? (
        <Avatar name={senderAvatarName} variant={isAvatar ? 'avatar' : 'human'} size={16} />
      ) : null}
      <Text variant="micro" tone="muted" mono>
        {mine ? '我' : (senderName ?? '成员')}
        {isAvatar ? ' · AI 代发' : ''}
        {onBehalfOfMe ? ' · 代表你' : ''} · {formatTime(createdAt)}
      </Text>
    </View>
  );
}

function MessageSurface({
  mine,
  isAvatar,
  recalled,
  text,
  streaming = false,
  onPress,
  onLongPress,
  accessibilityLabel,
}: {
  mine: boolean;
  isAvatar: boolean;
  recalled: boolean;
  text: string;
  streaming?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
    >
      <View
        style={{
          borderRadius: isAvatar ? 0 : 16,
          paddingHorizontal: isAvatar ? 0 : 13,
          paddingVertical: isAvatar ? 0 : 9,
          backgroundColor: isAvatar
            ? 'transparent'
            : recalled
              ? 'transparent'
              : mine
                ? t.bubbleUser
                : t.bubble,
          borderWidth: recalled && !isAvatar ? 1 : 0,
          borderColor: t.border,
          borderStyle: recalled ? 'dashed' : 'solid',
        }}
      >
        <Text
          style={{
            fontSize: 15,
            lineHeight: isAvatar ? 24 : 21,
            color: recalled ? t.textMuted : mine ? t.bubbleUserText : t.text,
          }}
        >
          {text}
          {streaming ? <BlinkingCursor color={t.primary} /> : null}
        </Text>
      </View>
    </Pressable>
  );
}

function CardView({
  card,
  msgId,
  onAction,
}: {
  card: CardPayload;
  msgId: string;
  onAction: (msgId: string, action: CardAction, editedText?: string) => void;
}) {
  const t = useTheme();
  const router = useRouter();
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');

  const header = (icon: React.ReactNode, title: string, badge?: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      {icon}
      <Text variant="body" style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>
        {title}
      </Text>
      {badge}
    </View>
  );

  const actions = (...buttons: React.ReactNode[]) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>{buttons}</View>
  );

  const act = (label: string, action: CardAction, primary = false, edited?: string) => (
    <Button
      size="sm"
      fullWidth={false}
      label={label}
      variant={primary ? 'primary' : 'outline'}
      onPress={() => {
        onAction(msgId, action, edited);
        setDone(action);
      }}
    />
  );

  const editor = (placeholder: string, minHeight: number) => (
    <Input
      value={editedText}
      onChangeText={setEditedText}
      multiline
      minHeight={minHeight}
      placeholder={placeholder}
      style={{ marginTop: 6 }}
    />
  );

  if (card.kind === 'draft') {
    return (
      <Card padding={12} style={{ width: 280 }}>
        {header(
          <Icon name="draft-line" size={16} color={t.primary} />,
          '草稿建议',
          <Badge label="待确认" tone="ai" />,
        )}
        {card.reason ? (
          <Text variant="micro" tone="muted" style={{ marginBottom: 6 }}>
            {card.reason}
          </Text>
        ) : null}
        <View style={{ backgroundColor: t.bubble, borderRadius: 10, padding: 10 }}>
          <Text>{card.draftText}</Text>
        </View>
        {done ? (
          <Text
            variant="caption"
            tone={done === 'discard' ? 'muted' : 'success'}
            style={{ marginTop: 8 }}
          >
            {done === 'discard' ? '已丢弃' : '已发送'}
          </Text>
        ) : editing ? (
          <View>
            {editor('修改后的内容…', 72)}
            {actions(
              act('发送修改版', 'edit', true, editedText),
              <Button
                key="cancel"
                size="sm"
                fullWidth={false}
                variant="ghost"
                label="取消"
                onPress={() => setEditing(false)}
              />,
            )}
          </View>
        ) : (
          actions(
            act('直接发送', 'send', true),
            <Button
              key="edit"
              size="sm"
              fullWidth={false}
              variant="outline"
              label="修改后发送"
              onPress={() => {
                setEditedText(card.draftText);
                setEditing(true);
              }}
            />,
            act('丢弃', 'discard'),
          )
        )}
      </Card>
    );
  }

  if (card.kind === 'approval') {
    return (
      <Card padding={12} tone="warning" style={{ width: 280 }}>
        {header(
          <Icon name="shield-keyhole-line" size={16} color={t.warning} />,
          card.title,
          <Badge label={`${card.risk} · 需确认`} tone="warning" />,
        )}
        <Text variant="micro" tone="muted" style={{ lineHeight: 16 }}>
          {card.summary}
        </Text>
        <Text variant="micro" tone="tertiary" style={{ marginTop: 4 }}>
          审批仅对本次生效；长期授权请在「分身控制台 → 策略 / 能力」中调整。
        </Text>
        <View style={{ backgroundColor: t.bubble, borderRadius: 8, padding: 8, marginTop: 6 }}>
          <Text variant="micro" tone="muted" mono numberOfLines={6}>
            {JSON.stringify(card.args, null, 2)}
          </Text>
        </View>
        {done ? (
          <Text
            variant="caption"
            tone={done === 'reject' ? 'danger' : 'success'}
            style={{ marginTop: 8 }}
          >
            {done === 'reject' ? '已拒绝' : done === 'modify_approve' ? '已修改并批准' : '已批准'}
          </Text>
        ) : editing ? (
          <View>
            {editor('以 JSON 修改参数后批准', 120)}
            {actions(
              act('按修改批准', 'modify_approve', true, editedText),
              <Button
                key="cancel"
                size="sm"
                fullWidth={false}
                variant="ghost"
                label="取消"
                onPress={() => setEditing(false)}
              />,
            )}
          </View>
        ) : (
          actions(
            act('批准（仅本次）', 'approve', true),
            <Button
              key="modify"
              size="sm"
              fullWidth={false}
              variant="outline"
              label="修改参数"
              onPress={() => {
                setEditedText(JSON.stringify(card.args, null, 2));
                setEditing(true);
              }}
            />,
            act('拒绝', 'reject'),
          )
        )}
      </Card>
    );
  }

  if (card.kind === 'task') {
    return (
      <Card padding={12} style={{ width: 280 }}>
        {header(
          <Icon name="task-line" size={16} color={t.primary} />,
          card.title,
          <Badge label={card.status} />,
        )}
        {card.summary ? (
          <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
            {card.summary}
          </Text>
        ) : null}
        {card.steps.map((s) => (
          <View
            key={`${s.name}-${s.status}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}
          >
            <Icon
              name={
                s.status === 'done'
                  ? 'checkbox-circle-line'
                  : s.status === 'running'
                    ? 'time-line'
                    : s.status === 'failed'
                      ? 'close-circle-line'
                      : 'circle-line'
              }
              size={14}
              color={
                s.status === 'done'
                  ? t.success
                  : s.status === 'failed'
                    ? t.danger
                    : s.status === 'running'
                      ? t.primary
                      : t.textMuted
              }
            />
            <Text variant="caption" tone="muted">
              {s.name}
            </Text>
          </View>
        ))}
        {card.status === 'running' && done === null ? actions(act('取消任务', 'cancel')) : null}
      </Card>
    );
  }

  if (card.kind === 'report') {
    return (
      <Card padding={12} style={{ width: 280 }}>
        {header(
          <Icon name="calendar-line" size={16} color={t.primary} />,
          `分身日报 · ${card.day}`,
          <Badge label="AI" tone="ai" />,
        )}
        <Text variant="bodySm" style={{ lineHeight: 19 }}>
          {card.summary}
        </Text>
        <Button
          size="sm"
          variant="outline"
          fullWidth={false}
          label="查看完整日报"
          onPress={() => router.push('/reports')}
          style={{ marginTop: 8 }}
        />
      </Card>
    );
  }

  if (card.kind === 'calendar_reminder') {
    return (
      <Card padding={12} style={{ width: 280 }}>
        {header(
          <Icon name="time-line" size={16} color={t.primary} />,
          '日程提醒',
          <Badge label="分身" tone="ai" />,
        )}
        <Text variant="body" style={{ fontWeight: '600' }}>
          {card.title}
        </Text>
        {card.summary ? (
          <Text variant="bodySm" style={{ lineHeight: 19, marginTop: 4 }}>
            {card.summary}
          </Text>
        ) : null}
      </Card>
    );
  }

  if (card.kind === 'reception_digest') {
    return (
      <Card padding={12} style={{ width: 280 }}>
        {header(
          <Icon name="history-line" size={16} color={t.primary} />,
          '分身接待摘要',
          <Badge label="交接" tone="ai" />,
        )}
        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
          {[
            ['收到', card.stats.received],
            ['回复', card.stats.replied],
            ['草稿', card.stats.drafts],
            ['静默', card.stats.silent],
            ['转交', card.stats.escalated],
          ].map(([label, value]) => (
            <View
              key={String(label)}
              style={{
                flex: 1,
                alignItems: 'center',
                backgroundColor: t.surfaceRaised,
                borderRadius: 6,
                paddingVertical: 4,
              }}
            >
              <Text variant="body" style={{ fontWeight: '600' }}>
                {value}
              </Text>
              <Text variant="micro" tone="muted">
                {label}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="bodySm" style={{ lineHeight: 19 }}>
          {card.summary}
        </Text>
        {card.pending.length > 0 ? (
          <Text variant="micro" tone="warning" style={{ marginTop: 6 }}>
            待确认：{card.pending.map((p) => p.title).join('、')}
          </Text>
        ) : null}
      </Card>
    );
  }

  if (card.kind === 'human_request') {
    return (
      <Card padding={12} tone="warning" style={{ width: 280 }}>
        {header(
          <Icon name="user-line" size={16} color={t.warning} />,
          '对方请求真人接待',
          <Badge label="待处理" tone="warning" />,
        )}
        <Text variant="bodySm" style={{ lineHeight: 19 }}>
          {card.requesterName} 希望与你本人沟通。
          {card.reason ? `\n${card.reason}` : ''}
        </Text>
        {done ? (
          <Text variant="micro" tone="success" style={{ marginTop: 8 }}>
            {done === 'grant_human' ? '已接管该会话' : '已保持分身接待'}
          </Text>
        ) : (
          actions(act('接管并回复', 'grant_human', true), act('保持分身接待', 'decline_human'))
        )}
      </Card>
    );
  }

  return (
    <Card padding={12} tone="warning" style={{ width: 280 }}>
      {header(
        <Icon name="alert-line" size={16} color={t.warning} />,
        '转交给你处理',
        <Badge label="需人工" tone="warning" />,
      )}
      <Text variant="bodySm" style={{ lineHeight: 19 }}>
        {card.summary}
      </Text>
    </Card>
  );
}

/** 流式光标：内置 Animated 呼吸，避免引入额外动画库 */
function BlinkingCursor({ color }: { color?: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.15,
          duration: 450,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 450,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={{ color, opacity }}>▍</Animated.Text>;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
