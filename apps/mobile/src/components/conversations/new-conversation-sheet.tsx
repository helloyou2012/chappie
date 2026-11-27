import { api, type ContactView } from '@chappie/shared';
import { useEffect, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import {
  Avatar,
  BottomSheet,
  Button,
  EmptyState,
  Input,
  ListRow,
  SegmentedControl,
  Spinner,
} from '@/ui';

/** 发起单聊 / 群聊：选择联系人、按邮箱加好友。 */
export function NewConversationSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (convId: string) => void;
}) {
  const t = useTheme();
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSelected([]);
    setTitle('');
    setTab('direct');
    setContactEmail('');
    setContactsLoading(true);
    api
      .listContacts()
      .then((res) => setContacts(res.contacts))
      .catch(() => setContacts([]))
      .finally(() => setContactsLoading(false));
  }, [visible]);

  const addContact = async () => {
    const email = contactEmail.trim();
    if (!email) return;
    setAdding(true);
    try {
      const res = await api.sendFriendRequest({ email });
      setContactEmail('');
      if (res.request.status === 'accepted') {
        const contactsRes = await api.listContacts();
        setContacts(contactsRes.contacts);
        Alert.alert('已互为联系人', res.request.toUser.name);
      } else {
        Alert.alert('好友申请已发送', `等待 ${res.request.toUser.name} 确认`);
      }
    } catch (e) {
      Alert.alert('发送失败', e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const create = async () => {
    if (selected.length === 0) return;
    setCreating(true);
    try {
      const res = await api.createConversation({
        type: tab,
        memberUserIds: selected,
        title: tab === 'group' ? title.trim() || '新群聊' : undefined,
      });
      onCreated(res.view.conversation.id);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="发起会话"
      description="选择联系人发起单聊，或创建群聊。对方与双方的分身会一同加入。"
      maxHeight="82%"
    >
      <SegmentedControl
        options={[
          { value: 'direct', label: '单聊' },
          { value: 'group', label: '群聊' },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setSelected([]);
        }}
        style={{ marginBottom: 8 }}
      />
      {tab === 'group' ? (
        <Input
          value={title}
          onChangeText={setTitle}
          placeholder="群聊名称（可选）"
          style={{ marginBottom: 8 }}
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        <Input
          size="sm"
          value={contactEmail}
          onChangeText={setContactEmail}
          placeholder="输入邮箱发送好友申请"
          autoCapitalize="none"
          keyboardType="email-address"
          style={{ flex: 1 }}
        />
        <Button
          size="sm"
          variant="outline"
          fullWidth={false}
          label={adding ? '发送中' : '发送申请'}
          loading={adding}
          disabled={!contactEmail.trim()}
          onPress={() => void addContact()}
        />
      </View>

      {contactsLoading ? (
        <Spinner />
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(c) => c.user.id}
          style={{ maxHeight: 280 }}
          renderItem={({ item }) => {
            const checked = selected.includes(item.user.id);
            return (
              <ListRow
                leading={<Avatar name={item.user.name} size={34} />}
                title={item.user.name}
                subtitle={item.user.email}
                selected={checked}
                trailing={checked ? <Icon name="check-line" size={18} color={t.primary} /> : null}
                onPress={() => {
                  if (tab === 'direct') setSelected([item.user.id]);
                  else
                    setSelected((prev) =>
                      prev.includes(item.user.id)
                        ? prev.filter((x) => x !== item.user.id)
                        : [...prev, item.user.id],
                    );
                }}
              />
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="contacts-line"
              title="还没有联系人"
              description="用上方邮箱框添加，对方注册后即可发起会话"
            />
          }
        />
      )}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Button
          label={tab === 'direct' ? '发起单聊' : `创建群聊（${selected.length}）`}
          loading={creating}
          disabled={selected.length === 0}
          onPress={() => void create()}
          style={{ flex: 1 }}
        />
        <Button label="取消" variant="outline" fullWidth={false} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}
