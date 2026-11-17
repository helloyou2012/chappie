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
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 5,
        alignItems: mine ? 'flex-end' : 'flex-start',
      }}
    >
      <View style={{ maxWidth: '82%' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginBottom: 3,
          }}
        >
          {!mine && sender ? (
            <Avatar name={sender.name} variant={isAvatar ? 'avatar' : 'human'} size={16} />
          ) : null}
          <Text variant="micro" tone="muted">
            {mine ? '我' : (sender?.name ?? '成员')}
            {isAvatar ? ' · AI 代发' : ''}
            {isAvatar && message.onBehalfOf === myId ? ' · 代表你' : ''} ·{' '}
            {formatTime(message.createdAt)}
          </Text>
        </View>
        <Pressable
          onPress={
            isAvatar && message.aiMeta?.explanation ? () => setShowExplain((v) => !v) : undefined
          }
          onLongPress={() => {
            if (!message.recalled) setSheetOpen(true);
          }}
          delayLongPress={260}
          accessibilityRole="text"
          accessibilityLabel={`${mine ? '我' : (sender?.name ?? '成员')}：${text}`}
        >
          <View
            style={{
              borderRadius: 16,
              paddingHorizontal: 13,
              paddingVertical: 9,
              backgroundColor: message.recalled
                ? 'transparent'
                : mine
                  ? t.bubbleUser
                  : isAvatar
                    ? t.aiBubble
                    : t.bubble,
              borderWidth: message.recalled ? 1 : 0,
              borderColor: t.border,
              borderStyle: message.recalled ? 'dashed' : 'solid',
            }}
          >
            <Text
              style={{
                fontSize: 15,
                lineHeight: 21,
                color: message.recalled
                  ? t.textMuted
                  : mine
                    ? t.bubbleUserText
                    : isAvatar
                      ? t.aiText
                      : t.text,
              }}
            >
              {text}
            </Text>
          </View>
        </Pressable>
        {notice ? (
          <Text variant="micro" tone="success" style={{ marginTop: 2 }}>
            {notice}
          </Text>
        ) : null}
        {isAvatar && showExplain && message.aiMeta?.explanation ? (
          <Card padding={9} style={{ marginTop: 5 }}>
            <Text variant="micro" tone="primary" style={{ fontWeight: '600', marginBottom: 3 }}>
              ✨ 为什么这么回
            </Text>
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
      </View>

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
    </View>
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
        <View style={{ backgroundColor: t.bubble, borderRadius: 8, padding: 8, marginTop: 6 }}>
          <Text variant="micro" tone="muted" numberOfLines={6}>
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
            act('批准', 'approve', true),
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
