import { contentText } from '@chappie/contract';
import type { CardPayload, MemberView, Message } from '@chappie/shared';
import { formatTime } from '@chappie/shared';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';

export type CardAction = 'send' | 'discard' | 'approve' | 'reject' | 'cancel';

export function MessageBubble({
  message,
  members,
  myId,
  onCardAction,
}: {
  message: Message;
  members: MemberView[];
  myId: string;
  onCardAction: (msgId: string, action: CardAction) => void;
}) {
  const t = useTheme();
  const mine = message.senderId === myId;
  const isAvatar = message.senderType === 'avatar';
  const sender = members.find((m) => m.principalId === message.senderId);
  const [showExplain, setShowExplain] = useState(false);

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

  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 5,
        alignItems: mine ? 'flex-end' : 'flex-start',
      }}
    >
      <View style={{ maxWidth: '82%' }}>
        <Text style={{ fontSize: 10, color: t.textMuted, marginBottom: 3 }}>
          {mine ? '我' : (sender?.name ?? '成员')}
          {isAvatar ? ' · AI 代发' : ''} · {formatTime(message.createdAt)}
        </Text>
        <Pressable
          onPress={
            isAvatar && message.aiMeta?.explanation ? () => setShowExplain((v) => !v) : undefined
          }
        >
          <View
            style={{
              borderRadius: 16,
              paddingHorizontal: 13,
              paddingVertical: 9,
              backgroundColor: message.recalled
                ? 'transparent'
                : mine
                  ? t.primary
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
                    ? t.primaryFg
                    : isAvatar
                      ? t.aiText
                      : t.text,
              }}
            >
              {text}
            </Text>
          </View>
        </Pressable>
        {isAvatar && showExplain && message.aiMeta?.explanation ? (
          <View
            style={{
              marginTop: 5,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: t.card,
              padding: 9,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: '600', color: t.primary, marginBottom: 3 }}>
              ✨ 为什么这么回
            </Text>
            <Text style={{ fontSize: 11, color: t.textMuted, lineHeight: 16 }}>
              {message.aiMeta.explanation.reason}
            </Text>
            <Text style={{ fontSize: 10, color: t.textMuted, marginTop: 4 }}>
              置信度 {(message.aiMeta.explanation.confidence * 100).toFixed(0)}%
              {message.aiMeta.explanation.toolsUsed.length > 0
                ? ` · 工具 ${message.aiMeta.explanation.toolsUsed.join('、')}`
                : ''}
            </Text>
          </View>
        ) : null}
      </View>
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
  onAction: (msgId: string, action: CardAction) => void;
}) {
  const t = useTheme();
  const [done, setDone] = useState<string | null>(null);

  const header = (icon: React.ReactNode, title: string, badge?: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      {icon}
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: t.text }}>{title}</Text>
      {badge ? <Text style={{ fontSize: 10, color: t.textMuted }}>{badge}</Text> : null}
    </View>
  );

  const btn = (label: string, action: CardAction, primary = false) => (
    <Pressable
      key={label}
      onPress={() => {
        onAction(msgId, action);
        setDone(action);
      }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 9,
        backgroundColor: primary ? t.primary : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: t.border,
        marginRight: 8,
        marginTop: 8,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: primary ? t.primaryFg : t.text }}>
        {label}
      </Text>
    </Pressable>
  );

  if (card.kind === 'draft') {
    return (
      <View
        style={{
          width: 280,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.card,
          padding: 12,
        }}
      >
        {header(<Icon name="draft-line" size={16} color={t.primary} />, '草稿建议', '待确认')}
        {card.reason ? (
          <Text style={{ fontSize: 11, color: t.textMuted, marginBottom: 6 }}>{card.reason}</Text>
        ) : null}
        <View style={{ backgroundColor: t.bubble, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontSize: 14, lineHeight: 20, color: t.text }}>{card.draftText}</Text>
        </View>
        {done ? (
          <Text
            style={{
              fontSize: 12,
              color: done === 'discard' ? t.textMuted : t.success,
              marginTop: 8,
            }}
          >
            {done === 'discard' ? '已丢弃' : '已发送'}
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {btn('直接发送', 'send', true)}
            {btn('丢弃', 'discard')}
          </View>
        )}
      </View>
    );
  }

  if (card.kind === 'approval') {
    return (
      <View
        style={{
          width: 280,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: t.warning,
          backgroundColor: t.card,
          padding: 12,
        }}
      >
        {header(
          <Icon name="shield-keyhole-line" size={16} color={t.warning} />,
          card.title,
          `${card.risk} · 需确认`,
        )}
        <Text style={{ fontSize: 11, color: t.textMuted, lineHeight: 16 }}>{card.summary}</Text>
        <View style={{ backgroundColor: t.bubble, borderRadius: 8, padding: 8, marginTop: 6 }}>
          <Text style={{ fontSize: 10, color: t.textMuted }} numberOfLines={4}>
            {JSON.stringify(card.args)}
          </Text>
        </View>
        {done ? (
          <Text
            style={{ fontSize: 12, color: done === 'reject' ? t.danger : t.success, marginTop: 8 }}
          >
            {done === 'reject' ? '已拒绝' : '已批准'}
          </Text>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            {btn('批准', 'approve', true)}
            {btn('拒绝', 'reject')}
          </View>
        )}
      </View>
    );
  }

  if (card.kind === 'task') {
    return (
      <View
        style={{
          width: 280,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.card,
          padding: 12,
        }}
      >
        {header(<Icon name="task-line" size={16} color={t.primary} />, card.title, card.status)}
        {card.steps.map((s, i) => (
          <View
            key={i}
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
            <Text style={{ fontSize: 12, color: t.textMuted }}>{s.name}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (card.kind === 'report') {
    return (
      <View
        style={{
          width: 280,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.card,
          padding: 12,
        }}
      >
        {header(
          <Icon name="calendar-line" size={16} color={t.primary} />,
          `分身日报 · ${card.day}`,
        )}
        <Text style={{ fontSize: 13, lineHeight: 19, color: t.text }}>{card.summary}</Text>
      </View>
    );
  }

  return (
    <View
      style={{
        width: 280,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: t.warning,
        backgroundColor: t.card,
        padding: 12,
      }}
    >
      {header(<Icon name="alert-line" size={16} color={t.warning} />, '转交给你处理', '需人工')}
      <Text style={{ fontSize: 13, lineHeight: 19, color: t.text }}>{card.summary}</Text>
    </View>
  );
}
