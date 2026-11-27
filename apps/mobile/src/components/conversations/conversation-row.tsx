import { type ConversationView, formatTime } from '@chappie/shared';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, Badge, Text } from '@/ui';

/** 会话列表行：头像 + 未读数 / 标题 + 类型 / 最后一条预览 / 时间。 */
export function ConversationRow({
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
  // 群聊预览带发送者（「昵称: 内容」）
  const prefix =
    isGroup && !fromMe && view.lastMsgSenderName
      ? `${view.lastMsgSenderName}：`
      : fromMe
        ? '我：'
        : '';
  const unread = view.unreadCount > 99 ? '99+' : String(view.unreadCount);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${view.displayTitle}，${view.lastMsgPreview ?? '暂无消息'}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: pressed ? t.surfaceHover : 'transparent',
      })}
    >
      <View style={{ position: 'relative' }}>
        <Avatar
          name={view.displayTitle}
          variant={isSelf ? 'avatar' : isGroup ? 'group' : 'human'}
          size={48}
        />
        {view.unreadCount > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -4,
              right: -6,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 5,
              backgroundColor: t.danger,
              borderWidth: 1.5,
              borderColor: t.card,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: '600', color: '#ffffff' }}>{unread}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text variant="row" numberOfLines={1} style={{ flexShrink: 1 }}>
            {view.displayTitle}
          </Text>
          {isSelf ? <Badge label="分身" tone="ai" /> : null}
          {isGroup ? <Badge label="群聊" tone="brand" /> : null}
        </View>
        <Text variant="body" tone="muted" numberOfLines={1} style={{ marginTop: 3, fontSize: 13 }}>
          {prefix}
          {view.lastMsgPreview ?? '暂无消息'}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 6, alignSelf: 'flex-start', paddingTop: 3 }}>
        <Text variant="caption" tone="tertiary">
          {formatTime(view.lastMsgAt)}
        </Text>
        {muted ? <Icon name="notification-off-line" size={14} color={t.textTertiary} /> : null}
      </View>
    </Pressable>
  );
}
