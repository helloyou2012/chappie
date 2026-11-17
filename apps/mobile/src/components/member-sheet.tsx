/**
 * 群成员管理（移动端）：成员列表、群主加人/移除、成员退群。
 * 与 Web 端 MemberPanel 的成员管理能力对齐；仅普通群聊可用。
 */
import {
  api,
  type ContactView,
  type ConversationView,
  type MemberView,
  MODE_LABELS,
  useAuthStore,
  useChatStore,
} from '@chappie/shared';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Avatar, Badge, BottomSheet, Button, EmptyState, ListRow, Spinner, Text } from '@/ui';

export function MemberSheet({
  visible,
  onClose,
  convId,
  view,
  members,
  onLeft,
}: {
  visible: boolean;
  onClose: () => void;
  convId: string;
  view: ConversationView;
  members: MemberView[];
  onLeft: () => void;
}) {
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const loadMembers = useChatStore((s) => s.loadMembers);
  const loadConversations = useChatStore((s) => s.loadConversations);

  const isOwner = view.myRole === 'owner';
  const isGroup = view.conversation.type === 'group' && view.conversation.systemTag === null;

  const [addMode, setAddMode] = useState(false);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setAddMode(false);
      setSelected([]);
      setError(null);
    }
  }, [visible]);

  const openAdd = async () => {
    setAddMode(true);
    setError(null);
    try {
      const res = await api.listContacts();
      setContacts(res.contacts);
    } catch {
      setContacts([]);
    }
  };

  const addMembers = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.addMembers(convId, { memberUserIds: selected });
      await loadMembers(convId);
      await loadConversations();
      setAddMode(false);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (principalId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.removeMember(convId, principalId);
      await loadMembers(convId);
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeMember(convId, myId);
      await loadConversations();
      onLeft();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const existingHumans = new Set(
    members.filter((m) => m.principalType === 'human').map((m) => m.principalId),
  );
  const candidates = contacts.filter((c) => !existingHumans.has(c.user.id));

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`成员 · ${members.length}`}
      description={addMode ? '从联系人中选择（对方与 TA 的分身一同入群）' : undefined}
      maxHeight="80%"
    >
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginBottom: 8 }}>
          {error}
        </Text>
      ) : null}

      {addMode ? (
        <View>
          <FlatList
            data={candidates}
            keyExtractor={(c) => c.user.id}
            style={{ maxHeight: 300 }}
            renderItem={({ item }) => (
              <ListRow
                leading={<Avatar name={item.user.name} size={34} />}
                title={item.user.name}
                subtitle={item.user.email}
                selected={selected.includes(item.user.id)}
                trailing={
                  selected.includes(item.user.id) ? <Badge label="已选" tone="ai" /> : undefined
                }
                onPress={() => {
                  setSelected((prev) =>
                    prev.includes(item.user.id)
                      ? prev.filter((x) => x !== item.user.id)
                      : [...prev, item.user.id],
                  );
                }}
              />
            )}
            ListEmptyComponent={
              <EmptyState
                icon="user-add-line"
                title="没有可添加的联系人"
                description="先在「消息 → +」里按邮箱添加联系人"
              />
            }
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button
              label={busy ? '添加中…' : `添加到群（${selected.length}）`}
              loading={busy}
              disabled={selected.length === 0}
              onPress={() => void addMembers()}
              style={{ flex: 1 }}
            />
            <Button
              label="返回"
              variant="outline"
              fullWidth={false}
              onPress={() => setAddMode(false)}
            />
          </View>
        </View>
      ) : (
        <>
          <FlatList
            data={members}
            keyExtractor={(m) => m.principalId}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => {
              const isAvatar = item.principalType === 'avatar';
              const isMe = item.principalId === myId;
              const canRemove = isGroup && isOwner && !isAvatar && !isMe;
              return (
                <ListRow
                  leading={
                    <Avatar name={item.name} variant={isAvatar ? 'avatar' : 'human'} size={32} />
                  }
                  title={item.name}
                  subtitle={
                    isAvatar
                      ? `AI 分身 · ${MODE_LABELS[item.aiMode] ?? item.aiMode}`
                      : item.role === 'owner'
                        ? '群主'
                        : '成员'
                  }
                  trailing={
                    canRemove ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        tone="danger"
                        fullWidth={false}
                        label="移除"
                        disabled={busy}
                        onPress={() => void removeMember(item.principalId)}
                      />
                    ) : isMe ? (
                      <Badge label="我" tone="muted" />
                    ) : undefined
                  }
                  onPress={canRemove ? () => void removeMember(item.principalId) : undefined}
                />
              );
            }}
          />
          {addMode ? null : busy && !error ? <Spinner /> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            {isGroup && isOwner ? (
              <Button
                label="添加成员"
                variant="outline"
                onPress={() => void openAdd()}
                style={{ flex: 1 }}
              />
            ) : null}
            {isGroup && !isOwner ? (
              <Button
                label="退出群聊"
                variant="outline"
                tone="danger"
                onPress={() => void leave()}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
        </>
      )}
    </BottomSheet>
  );
}
