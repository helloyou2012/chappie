import { type ContactView, MODE_DESCRIPTIONS, MODE_LABELS, type Policy } from '@chappie/shared';
import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, Badge, BottomSheet, Button, Input, Text } from '@/ui';
import { displayName, type ContactMode as Mode } from './utils';

const MODES: Mode[] = ['manual', 'draft', 'auto', 'off'];

/** 联系人详情 / 备注 / 分身档位，单抽屉内切换视图。 */
export function ContactDetailSheet({
  contact,
  policy,
  busy,
  onClose,
  onStartChat,
  onRemove,
  onSaveAlias,
  onSaveMode,
}: {
  contact: ContactView | null;
  policy: Policy | undefined;
  busy: boolean;
  onClose: () => void;
  onStartChat: (c: ContactView) => void;
  onRemove: (c: ContactView) => void;
  onSaveAlias: (c: ContactView, alias: string | null) => Promise<void>;
  onSaveMode: (c: ContactView, mode: Mode) => Promise<void>;
}) {
  const t = useTheme();
  const [view, setView] = useState<'menu' | 'alias' | 'mode'>('menu');
  const [aliasDraft, setAliasDraft] = useState('');
  const [mode, setMode] = useState<Mode>('manual');
  const [savingAlias, setSavingAlias] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  // 换联系人时重置视图与草稿；同一联系人内部由按钮切换
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在联系人变化时重置，避免保存后草稿被覆盖
  useEffect(() => {
    setView('menu');
    setAliasDraft(contact?.alias ?? '');
    setMode(policy?.rule.mode ?? 'manual');
  }, [contact?.user.id]);

  const title = view === 'alias' ? '编辑备注名' : view === 'mode' ? '分身档位' : '联系人';
  const description =
    view === 'menu'
      ? undefined
      : view === 'alias'
        ? '留空表示清除备注。'
        : '只影响你的分身与 TA 的私聊表现；会话内单独切换的档位优先级更高。';

  const saveAlias = async () => {
    if (!contact) return;
    setSavingAlias(true);
    try {
      await onSaveAlias(contact, aliasDraft.trim() || null);
      setView('menu');
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAlias(false);
    }
  };

  const saveMode = async () => {
    if (!contact) return;
    setSavingMode(true);
    try {
      await onSaveMode(contact, mode);
      setView('menu');
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingMode(false);
    }
  };

  return (
    <BottomSheet
      visible={contact !== null}
      onClose={onClose}
      title={title}
      description={description}
      maxHeight="88%"
    >
      {view === 'menu' && contact ? (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
            <Avatar name={contact.user.name} size={56} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {displayName(contact)}
                </Text>
                <Badge
                  label={policy ? MODE_LABELS[policy.rule.mode] : '默认档位'}
                  tone={policy ? 'ai' : 'muted'}
                />
              </View>
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
                {contact.alias ? `${contact.user.name} · ` : ''}
                {contact.user.email}
              </Text>
            </View>
          </View>

          <Button
            label={busy ? '打开中…' : '发消息'}
            icon="chat-3-line"
            loading={busy}
            onPress={() => onStartChat(contact)}
            style={{ marginTop: 14 }}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <Button
              size="sm"
              variant="outline"
              label="备注"
              icon="edit-line"
              onPress={() => {
                setAliasDraft(contact.alias ?? '');
                setView('alias');
              }}
              style={{ flex: 1 }}
            />
            <Button
              size="sm"
              variant="outline"
              label="分身档位"
              icon="robot-2-line"
              onPress={() => {
                setMode(policy?.rule.mode ?? 'manual');
                setView('mode');
              }}
              style={{ flex: 1 }}
            />
          </View>
          <Button
            size="sm"
            variant="ghost"
            tone="danger"
            label="移除联系人"
            disabled={busy}
            onPress={() => onRemove(contact)}
            style={{ marginTop: 6 }}
          />
        </View>
      ) : view === 'alias' ? (
        <View>
          <Text variant="micro" tone="muted" numberOfLines={2} style={{ marginBottom: 8 }}>
            {contact ? `${contact.user.name} · ${contact.user.email}` : ''}
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
              onPress={() => setView('menu')}
            />
          </View>
        </View>
      ) : (
        <View>
          {MODES.map((m) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === m }}
              onPress={() => setMode(m)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 }}
            >
              <Icon
                name={mode === m ? 'radio-button-line' : 'checkbox-blank-circle-line'}
                size={20}
                color={mode === m ? t.primary : t.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text variant="body" style={{ fontWeight: '600' }}>
                  {MODE_LABELS[m]}
                </Text>
                <Text variant="micro" tone="muted" style={{ marginTop: 1 }}>
                  {MODE_DESCRIPTIONS[m]}
                </Text>
              </View>
            </Pressable>
          ))}
          <Button
            label="保存档位"
            loading={savingMode}
            onPress={() => void saveMode()}
            style={{ marginTop: 14 }}
          />
        </View>
      )}
    </BottomSheet>
  );
}
