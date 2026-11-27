import { type ConversationView, type MemberView, RECEPTION_LABELS } from '@chappie/shared';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { modeLabels } from '@/theme';
import { IconButton, NavBar, Text } from '@/ui';

const SHORT_RECEPTION: Record<string, string> = {
  human: '真人',
  avatar: '分身',
  paused: '暂停',
};

/** 会话头部：居中标题 + 返回 + 我的接待方式 / 成员入口。 */
export function ChatHeader({
  view,
  members,
  onBack,
  onModePress,
  onMembersPress,
}: {
  view: ConversationView | undefined;
  members: MemberView[];
  onBack: () => void;
  onModePress: () => void;
  onMembersPress: () => void;
}) {
  const selfChat = view?.conversation.systemTag === 'avatar_self';
  const isGroupChat = Boolean(
    view && view.conversation.type === 'group' && view.conversation.systemTag === null,
  );
  const modeLabel = view?.myReception
    ? (SHORT_RECEPTION[view.myReception.state] ?? RECEPTION_LABELS[view.myReception.state])
    : modeLabels[view?.myAiMode ?? 'manual'];
  const temporary = Boolean(view?.myReception?.until);
  // 与 ModePill 的实际宽度保持一致：内边距 14 + 12px/字 + 临时时钟 15
  const modePillWidth = 14 + modeLabel.length * 12 + (temporary ? 15 : 0);

  return (
    <NavBar
      rightInset={selfChat ? 68 : 72 + modePillWidth + (isGroupChat ? 36 : 0)}
      title={view?.displayTitle ?? '会话'}
      subtitle={
        selfChat
          ? '与分身直接对话'
          : view?.conversation.type === 'group'
            ? `${members.filter((m) => m.principalType === 'human').length} 位成员 · ${
                members.filter((m) => m.principalType === 'avatar').length
              } 个分身`
            : view?.peerReception?.state === 'avatar'
              ? '对方由 AI 分身接待'
              : '对方当前为真人接待'
      }
      onBack={onBack}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {selfChat ? null : (
            <ModePill
              label={modeLabel}
              avatar={view?.myReception?.state === 'avatar'}
              temporary={temporary}
              onPress={onModePress}
            />
          )}
          {isGroupChat ? (
            <IconButton icon="team-line" label="成员管理" size={36} onPress={onMembersPress} />
          ) : null}
        </View>
      }
    />
  );
}

/** 头部的接待方式胶囊：短标签 + 底色，临时托管带时钟。 */
function ModePill({
  label,
  avatar,
  temporary,
  onPress,
}: {
  label: string;
  avatar: boolean;
  temporary: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const color = avatar ? t.aiText : t.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`我的接待方式：${label}${temporary ? '（临时）' : ''}`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        height: 26,
        paddingHorizontal: 7,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: avatar ? t.aiBubble : t.surfaceRaised,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color }}>{label}</Text>
      {temporary ? <Icon name="time-line" size={12} color={color} /> : null}
    </Pressable>
  );
}
