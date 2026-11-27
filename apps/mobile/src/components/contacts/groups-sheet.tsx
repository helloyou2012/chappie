import type { ConversationView } from '@chappie/shared';
import { Avatar, BottomSheet, EmptyState, GroupRow } from '@/ui';

/** 通讯录里的群聊列表。 */
export function GroupsSheet({
  visible,
  onClose,
  groups,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  groups: ConversationView[];
  onOpen: (id: string) => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`群聊（${groups.length}）`}
      maxHeight="80%"
      scroll
    >
      {groups.map((g) => (
        <GroupRow
          key={g.conversation.id}
          leading={<Avatar name={g.displayTitle} variant="group" size={40} />}
          title={g.displayTitle}
          subtitle={g.lastMsgPreview ?? '暂无消息'}
          chevron
          onPress={() => onOpen(g.conversation.id)}
        />
      ))}
      {groups.length === 0 ? <EmptyState title="还没有群聊" /> : null}
    </BottomSheet>
  );
}
