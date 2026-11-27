import {
  adminApi,
  api,
  type ContactView,
  type ConversationView,
  type FriendRequestView,
  groupByInitial,
  type Policy,
  useChatStore,
} from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, View } from 'react-native';
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet';
import { ContactRow } from '@/components/contacts/contact-row';
import { GroupsSheet } from '@/components/contacts/groups-sheet';
import { ContactsQuickEntries } from '@/components/contacts/quick-entries';
import { FriendRequestsSheet } from '@/components/contacts/requests-sheet';
import { type ContactMode, contactPolicy, displayName } from '@/components/contacts/utils';
import { useTheme } from '@/hooks/use-theme';
import { EmptyState, IconButton, NavBar, SearchField, SectionHeader, Spinner, Text } from '@/ui';

export default function ContactsScreen() {
  const t = useTheme();
  const router = useRouter();
  const friendRequestVersion = useChatStore((s) => s.friendRequestVersion);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestView[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestView[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ConversationView[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const listRef = useRef<SectionList<ContactView, { title: string }>>(null);

  // 联系人详情 / 备注 / 档位共用同一个抽屉，避免 iOS 上多个 Modal 叠加
  const [sheetContact, setSheetContact] = useState<ContactView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactRes, policyRes, convRes, requestRes] = await Promise.all([
        api.listContacts(),
        adminApi.listPolicies(),
        api.listConversations(),
        api.listFriendRequests(),
      ]);
      setContacts(contactRes.contacts);
      setIncomingRequests(requestRes.incoming);
      setOutgoingRequests(requestRes.outgoing);
      setPolicies(policyRes.policies);
      setGroups(
        convRes.views.filter(
          (v) => v.conversation.type === 'group' && v.conversation.systemTag === null,
        ),
      );
    } catch {
      // 网络异常时保留现有列表；下拉/重进可重试
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (friendRequestVersion > 0) void load();
  }, [friendRequestVersion, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.user.name.toLowerCase().includes(q) ||
        c.user.email.toLowerCase().includes(q) ||
        (c.alias ?? '').toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const grouped = useMemo(() => groupByInitial(filtered, (c) => displayName(c)), [filtered]);

  const add = async (value: string): Promise<boolean> => {
    try {
      const res = await api.sendFriendRequest({ email: value });
      if (res.request.status === 'accepted') {
        await load();
        Alert.alert('已互为联系人', res.request.toUser.name);
      } else {
        setOutgoingRequests((prev) => [res.request, ...prev]);
        Alert.alert('好友申请已发送', `等待 ${res.request.toUser.name} 确认`);
      }
      return true;
    } catch (e) {
      Alert.alert('发送失败', e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const acceptRequest = async (r: FriendRequestView) => {
    setBusyId(r.id);
    try {
      await api.acceptFriendRequest(r.id);
      await load();
    } catch (e) {
      Alert.alert('接受失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const rejectRequest = async (r: FriendRequestView) => {
    setBusyId(r.id);
    try {
      await api.rejectFriendRequest(r.id);
      setIncomingRequests((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      Alert.alert('操作失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const cancelRequest = async (r: FriendRequestView) => {
    setBusyId(r.id);
    try {
      await api.cancelFriendRequest(r.id);
      setOutgoingRequests((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      Alert.alert('撤回失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openContact = (c: ContactView) => {
    setSheetContact(c);
  };

  const saveAliasFor = async (contact: ContactView, alias: string | null) => {
    const res = await api.updateContact(contact.user.id, { alias });
    setContacts((prev) => prev.map((c) => (c.user.id === res.contact.user.id ? res.contact : c)));
    setSheetContact((prev) => (prev && prev.user.id === res.contact.user.id ? res.contact : prev));
  };

  const saveModeFor = async (contact: ContactView, mode: ContactMode) => {
    const existing = contactPolicy(policies, contact.user.id);
    if (existing) {
      await adminApi.updatePolicy(existing.id, { rule: { ...existing.rule, mode } });
    } else {
      await adminApi.createPolicy({
        scopeType: 'contact',
        scopeId: contact.user.id,
        name: `联系人 · ${displayName(contact)}`,
        rule: {
          mode,
          schedule: [],
          allowCapabilities: null,
          denyTopics: [],
          maxRisk: 'L1',
          rateLimitPerHour: 20,
          escalateWhen: [],
        },
      });
    }
    const res = await adminApi.listPolicies();
    setPolicies(res.policies);
  };

  const remove = (c: ContactView) => {
    Alert.alert('移除联系人', `从联系人中移除「${displayName(c)}」？已有会话不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          setSheetContact(null);
          setBusyId(c.user.id);
          void api
            .removeContact(c.user.id)
            .then(() => setContacts((prev) => prev.filter((x) => x.user.id !== c.user.id)))
            .catch((e) => Alert.alert('移除失败', e instanceof Error ? e.message : String(e)))
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  const startChat = async (c: ContactView) => {
    setSheetContact(null);
    setBusyId(c.user.id);
    try {
      const res = await api.createConversation({
        type: 'direct',
        memberUserIds: [c.user.id],
      });
      router.push(`/chat/${res.view.conversation.id}`);
    } catch (e) {
      Alert.alert('发起会话失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <NavBar
        title="通讯录"
        rightInset={82}
        onBack={() => router.back()}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <IconButton
              icon="search-line"
              label="搜索联系人"
              size={38}
              tone={searchOpen ? 'primary' : 'default'}
              onPress={() => {
                setSearchOpen((v) => !v);
                if (searchOpen) setQuery('');
              }}
            />
            <IconButton
              icon="add-line"
              label="添加联系人"
              size={38}
              onPress={() => setRequestsOpen(true)}
            />
          </View>
        }
      />

      {searchOpen ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <SearchField
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="姓名 / 邮箱 / 备注"
            onCancel={() => {
              setSearchOpen(false);
              setQuery('');
            }}
          />
        </View>
      ) : null}

      {loading ? (
        <Spinner />
      ) : (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <SectionList
            ref={listRef}
            style={{ flex: 1 }}
            sections={grouped}
            keyExtractor={(c) => c.user.id}
            stickySectionHeadersEnabled
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={
              <>
                <ContactsQuickEntries
                  incomingCount={incomingRequests.length}
                  groupCount={groups.length}
                  onRequests={() => setRequestsOpen(true)}
                  onGroups={() => setGroupsOpen(true)}
                />
                <SectionHeader title={query.trim() ? '搜索结果' : '我的联系人'} />
              </>
            }
            SectionSeparatorComponent={() => <View style={{ height: 0 }} />}
            renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
            renderItem={({ item: c }) => (
              <ContactRow
                contact={c}
                policy={contactPolicy(policies, c.user.id)}
                busy={busyId === c.user.id}
                onPress={() => openContact(c)}
              />
            )}
            ListEmptyComponent={
              <EmptyState
                icon="contacts-line"
                title={contacts.length === 0 ? '还没有联系人' : '没有匹配的联系人'}
                description={
                  contacts.length === 0
                    ? '点右上角 + 按邮箱添加，对方接受后即可发起会话'
                    : '换个关键词试试'
                }
              />
            }
          />
          {/* 右侧字母索引 */}
          {grouped.length > 1 && !searchOpen ? (
            <View
              style={{
                position: 'absolute',
                right: 2,
                top: 32,
                bottom: 32,
                justifyContent: 'center',
                gap: 0.5,
              }}
            >
              {grouped.map((section) => (
                <Pressable
                  key={section.title}
                  onPress={() => {
                    const index = grouped.findIndex((g) => g.title === section.title);
                    if (index >= 0) {
                      listRef.current?.scrollToLocation({
                        sectionIndex: index,
                        itemIndex: 0,
                        animated: true,
                      });
                    }
                  }}
                  hitSlop={3}
                  style={{ paddingHorizontal: 7, paddingVertical: 1 }}
                >
                  <Text variant="micro" tone="tertiary" style={{ fontWeight: '500' }}>
                    {section.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}

      <ContactDetailSheet
        contact={sheetContact}
        policy={sheetContact ? contactPolicy(policies, sheetContact.user.id) : undefined}
        busy={sheetContact ? busyId === sheetContact.user.id : false}
        onClose={() => setSheetContact(null)}
        onStartChat={(c) => void startChat(c)}
        onRemove={remove}
        onSaveAlias={saveAliasFor}
        onSaveMode={saveModeFor}
      />

      <FriendRequestsSheet
        visible={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        incoming={incomingRequests}
        outgoing={outgoingRequests}
        busyId={busyId}
        onAdd={add}
        onAccept={(r) => void acceptRequest(r)}
        onReject={(r) => void rejectRequest(r)}
        onCancel={(r) => void cancelRequest(r)}
      />

      <GroupsSheet
        visible={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        groups={groups}
        onOpen={(id) => {
          setGroupsOpen(false);
          router.push(`/chat/${id}`);
        }}
      />
    </View>
  );
}
