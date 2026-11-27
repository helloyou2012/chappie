import { Badge, Group, GroupRow, TileIcon } from '@/ui';

/** 通讯录顶部入口：新的朋友 / 群聊。 */
export function ContactsQuickEntries({
  incomingCount,
  groupCount,
  onRequests,
  onGroups,
}: {
  incomingCount: number;
  groupCount: number;
  onRequests: () => void;
  onGroups: () => void;
}) {
  return (
    <Group dividerInset={58} style={{ marginBottom: 8 }}>
      <GroupRow
        leading={<TileIcon name="user-add-line" color="orange" />}
        title="新的朋友"
        chevron={false}
        trailing={
          incomingCount > 0 ? <Badge label={String(incomingCount)} tone="danger" /> : undefined
        }
        onPress={onRequests}
      />
      <GroupRow
        leading={<TileIcon name="group-line" color="green" />}
        title="群聊"
        value={`${groupCount}`}
        chevron={false}
        onPress={onGroups}
      />
    </Group>
  );
}
