import { contentText } from '@chappie/contract';
import type { CardPayload, MemberView, Message } from '@chappie/shared';
import { api, formatTime } from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { realtime } from '@/realtime';
import { Avatar, Badge, BottomSheet, Button, Card, Dialog, Input, MenuRow, Text } from '@/ui';

export type CardAction =
  | 'send'
  | 'edit'
  | 'discard'
  | 'approve'
  | 'modify_approve'
  | 'reject'
  | 'cancel';

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

  const text = message.recalled
    ? '消息已撤回'
    : message.content.type === 'text'
      ? message.content.text
      : contentText(message.content);
  const canRecall = !message.recalled && (mine || message.onBehalfOf === myId);

  const feedback = (type: 'like' | 'report') => {
    void api
      .feedback(message.msgId, { type })
      .then(() => setNotice(type === 'like' ? '已点赞' : '已举报'))
      .catch(() => setNotice('反馈失败'));
  };

  return (
    <>
      <MessageRow mine={mine}>
        <MessageIdentity
          mine={mine}
          senderName={sender?.name}
          senderType={isAvatar ? 'avatar' : 'human'}
          senderAvatarName={sender?.name}
          onBehalfOfMe={isAvatar && message.onBehalfOf === myId}
          createdAt={message.createdAt}
        />
        <MessageSurface
          mine={mine}
          isAvatar={isAvatar}
          recalled={message.recalled}
          text={text}
          onPress={
            isAvatar && message.aiMeta?.explanation ? () => setShowExplain((v) => !v) : undefined
          }
          onLongPress={message.recalled ? undefined : () => setSheetOpen(true)}
          accessibilityLabel={`${mine ? '我' : (sender?.name ?? '成员')}：${text}`}
        />
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

function MessageRow({ mine, children }: { mine: boolean; children: React.ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 5,
        alignItems: mine ? 'flex-end' : 'flex-start',
      }}
    >
      <View style={{ maxWidth: '82%' }}>{children}</View>
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
  onPress,
  onLongPress,
  accessibilityLabel,
}: {
  mine: boolean;
  isAvatar: boolean;
  recalled: boolean;
  text: string;
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
          borderRadius: 16,
          paddingHorizontal: 13,
          paddingVertical: 9,
          backgroundColor: recalled
            ? 'transparent'
            : mine
              ? t.bubbleUser
              : isAvatar
                ? t.aiBubble
                : t.bubble,
          borderWidth: recalled ? 1 : 0,
          borderColor: t.border,
          borderStyle: recalled ? 'dashed' : 'solid',
        }}
      >
        <Text
          style={{
            fontSize: 15,
            lineHeight: 21,
            color: recalled ? t.textMuted : mine ? t.bubbleUserText : isAvatar ? t.aiText : t.text,
          }}
        >
          {text}
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
