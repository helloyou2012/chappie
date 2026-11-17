import {
  adminApi,
  api,
  type ContactView,
  type ConversationView,
  groupByInitial,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  type Policy,
} from '@chappie/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  ListRow,
  PageHeader,
  Spinner,
  Text,
} from '@/ui';

const MODES = ['manual', 'draft', 'auto', 'off'] as const;

function displayName(c: ContactView): string {
  return c.alias?.trim() || c.user.name;
}

function contactPolicy(policies: Policy[], peerId: string): Policy | undefined {
  return policies.find((p) => p.scopeType === 'contact' && p.scopeId === peerId);
}

export default function ContactsScreen() {
  const t = useTheme();
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ConversationView[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const listRef = useRef<SectionList<ContactView, { title: string }>>(null);

  const [aliasTarget, setAliasTarget] = useState<ContactView | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [savingAlias, setSavingAlias] = useState(false);

  const [modeTarget, setModeTarget] = useState<ContactView | null>(null);
  const [mode, setMode] = useState<(typeof MODES)[number]>('manual');
  const [savingMode, setSavingMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactRes, policyRes, convRes] = await Promise.all([
        api.listContacts(),
        adminApi.listPolicies(),
        api.listConversations(),
      ]);
      setContacts(contactRes.contacts);
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

  const add = async () => {
    const value = email.trim();
    if (!value) return;
    setAdding(true);
    try {
      const res = await api.addContact({ email: value });
      setContacts((prev) =>
        prev.some((c) => c.user.id === res.contact.user.id) ? prev : [...prev, res.contact],
      );
      setEmail('');
    } catch (e) {
      Alert.alert('添加失败', e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const openAlias = (c: ContactView) => {
    setAliasTarget(c);
    setAliasDraft(c.alias ?? '');
  };

  const saveAlias = async () => {
    if (!aliasTarget) return;
    setSavingAlias(true);
    try {
      const res = await api.updateContact(aliasTarget.user.id, {
        alias: aliasDraft.trim() || null,
      });
      setContacts((prev) => prev.map((c) => (c.user.id === res.contact.user.id ? res.contact : c)));
      setAliasTarget(null);
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAlias(false);
    }
  };

  const openMode = (c: ContactView) => {
    setModeTarget(c);
    setMode(contactPolicy(policies, c.user.id)?.rule.mode ?? 'manual');
  };

  const saveMode = async () => {
    if (!modeTarget) return;
    setSavingMode(true);
    try {
      const existing = contactPolicy(policies, modeTarget.user.id);
      if (existing) {
        await adminApi.updatePolicy(existing.id, { rule: { ...existing.rule, mode } });
      } else {
        await adminApi.createPolicy({
          scopeType: 'contact',
          scopeId: modeTarget.user.id,
          name: `联系人 · ${displayName(modeTarget)}`,
          rule: {
            mode,
            schedule: [],
            allowCapabilities: null,
            denyTopics: [],
            maxRisk: 'L1',
            rateLimitPerHour: 20,
            escalateWhen: ['confidence<0.7'],
          },
        });
      }
      const res = await adminApi.listPolicies();
      setPolicies(res.policies);
      setModeTarget(null);
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMode(false);
    }
  };

  const remove = (c: ContactView) => {
    Alert.alert('移除联系人', `从联系人中移除「${displayName(c)}」？已有会话不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
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
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <PageHeader
        title="联系人"
        subtitle="备注、我的分身对 TA 的档位、发起单聊"
        onBack={() => router.back()}
      />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input
            size="sm"
            value={email}
            onChangeText={setEmail}
            placeholder="按邮箱添加联系人"
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ flex: 1 }}
          />
          <Button
            size="sm"
            fullWidth={false}
            label={adding ? '添加中' : '添加'}
            loading={adding}
            disabled={!email.trim()}
            onPress={() => void add()}
          />
        </View>
        <Input
          size="sm"
          value={query}
          onChangeText={setQuery}
          placeholder="搜索姓名 / 邮箱 / 备注"
        />
      </View>

      {/* 常驻入口：群聊 */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Card padding={4}>
          <ListRow
            leading={
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: t.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="group-line" size={18} color={t.textMuted} />
              </View>
            }
            title="群聊"
            subtitle={`${groups.length} 个群聊`}
            trailing={<Icon name="arrow-right-s-line" size={18} color={t.textMuted} />}
            onPress={() => setGroupsOpen(true)}
          />
        </Card>
      </View>

      {loading ? (
        <Spinner />
      ) : (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <SectionList
            ref={listRef}
            sections={grouped}
            keyExtractor={(c) => c.user.id}
            stickySectionHeadersEnabled
            contentContainerStyle={{ padding: 14, paddingRight: 24, paddingBottom: 32 }}
            SectionSeparatorComponent={() => <View style={{ height: 2 }} />}
            renderSectionHeader={({ section }) => (
              <View
                style={{
                  backgroundColor: t.bg,
                  paddingVertical: 3,
                  paddingHorizontal: 4,
                }}
              >
                <Text variant="micro" tone="muted" style={{ fontWeight: '600' }}>
                  {section.title}
                </Text>
              </View>
            )}
            renderItem={({ item: c }) => {
              const policy = contactPolicy(policies, c.user.id);
              return (
                <Card padding={12}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar name={c.user.name} size={38} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                          {displayName(c)}
                        </Text>
                        <Badge
                          label={policy ? MODE_LABELS[policy.rule.mode] : '默认档位'}
                          tone={policy ? 'ai' : 'outline'}
                        />
                      </View>
                      <Text variant="micro" tone="muted" numberOfLines={1}>
                        {c.alias ? `${c.user.name} · ` : ''}
                        {c.user.email}
                      </Text>
                    </View>
                    <Button
                      size="sm"
                      fullWidth={false}
                      label="发消息"
                      loading={busyId === c.user.id}
                      onPress={() => void startChat(c)}
                    />
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'flex-end',
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      label="档位"
                      icon="robot-2-line"
                      onPress={() => openMode(c)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      label="备注"
                      icon="edit-line"
                      onPress={() => openAlias(c)}
                    />
                    <IconButton
                      icon="delete-bin-line"
                      label={`移除 ${displayName(c)}`}
                      tone="danger"
                      size={34}
                      disabled={busyId === c.user.id}
                      onPress={() => remove(c)}
                    />
                  </View>
                </Card>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="contacts-line"
                title={contacts.length === 0 ? '还没有联系人' : '没有匹配的联系人'}
                description={
                  contacts.length === 0
                    ? '在上方按邮箱添加，对方注册后即可发起会话'
                    : '换个关键词试试'
                }
              />
            }
          />
          {/* 右侧字母索引 */}
          {grouped.length > 1 ? (
            <View
              style={{
                position: 'absolute',
                right: 4,
                top: 40,
                bottom: 40,
                justifyContent: 'center',
                gap: 1,
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
                  hitSlop={4}
                  style={{ paddingHorizontal: 6, paddingVertical: 1 }}
                >
                  <Text variant="micro" tone="tertiary">
                    {section.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}

      {/* 备注名 */}
      <Dialog
        visible={aliasTarget !== null}
        onClose={() => setAliasTarget(null)}
        title="编辑备注名"
      >
        <Text variant="micro" tone="muted" style={{ marginBottom: 8 }} numberOfLines={2}>
          {aliasTarget ? `${aliasTarget.user.name} · ${aliasTarget.user.email}` : ''}
          ；留空表示清除备注。
        </Text>
        <Input
          autoFocus
          value={aliasDraft}
          maxLength={40}
          onChangeText={setAliasDraft}
          placeholder="如：大学室友 / 王总"
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button
            label="保存"
            loading={savingAlias}
            onPress={() => void saveAlias()}
            style={{ flex: 1 }}
          />
          <Button
            label="取消"
            variant="ghost"
            fullWidth={false}
            onPress={() => setAliasTarget(null)}
          />
        </View>
      </Dialog>

      {/* 对 TA 的分身档位 */}
      <BottomSheet
        visible={modeTarget !== null}
        onClose={() => setModeTarget(null)}
        title={modeTarget ? `我的分身对「${displayName(modeTarget)}」的档位` : '我的分身档位'}
        description="只影响你的分身与 TA 的私聊表现，不会修改对方分身的设置；会话内单独切换的档位优先级更高。"
      >
        {MODES.map((m) => (
          <View
            key={m}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}
          >
            <Button
              size="sm"
              variant={mode === m ? 'primary' : 'outline'}
              fullWidth={false}
              label={MODE_LABELS[m]}
              onPress={() => setMode(m)}
            />
            <Text variant="caption" tone={mode === m ? 'default' : 'muted'} style={{ flex: 1 }}>
              {MODE_DESCRIPTIONS[m]}
            </Text>
            {mode === m ? <Icon name="check-line" size={16} color={t.agent} /> : null}
          </View>
        ))}
        <Button
          label="保存档位"
          loading={savingMode}
          onPress={() => void saveMode()}
          style={{ marginTop: 16 }}
        />
      </BottomSheet>

      {/* 群聊列表 */}
      <BottomSheet
        visible={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        title={`群聊（${groups.length}）`}
        maxHeight="80%"
      >
        <SectionList
          sections={[{ title: '群聊', data: groups }]}
          keyExtractor={(g) => g.conversation.id}
          style={{ maxHeight: 420 }}
          renderSectionHeader={() => null}
          renderItem={({ item: g }) => (
            <ListRow
              leading={<Avatar name={g.displayTitle} variant="group" size={34} />}
              title={g.displayTitle}
              subtitle={g.lastMsgPreview ?? '暂无消息'}
              onPress={() => {
                setGroupsOpen(false);
                router.push(`/chat/${g.conversation.id}`);
              }}
            />
          )}
          ListEmptyComponent={<EmptyState title="还没有群聊" />}
        />
      </BottomSheet>
    </View>
  );
}
