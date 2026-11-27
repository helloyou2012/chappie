import type { FriendRequestView } from '@chappie/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Avatar, BottomSheet, Button, EmptyState, Input, Text } from '@/ui';

/** 新的朋友：按邮箱添加，处理收到 / 发出的好友申请。 */
export function FriendRequestsSheet({
  visible,
  onClose,
  incoming,
  outgoing,
  busyId,
  onAdd,
  onAccept,
  onReject,
  onCancel,
}: {
  visible: boolean;
  onClose: () => void;
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
  busyId: string | null;
  onAdd: (email: string) => Promise<boolean>;
  onAccept: (r: FriendRequestView) => void;
  onReject: (r: FriendRequestView) => void;
  onCancel: (r: FriendRequestView) => void;
}) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [adding, setAdding] = useState(false);

  const add = async () => {
    const value = email.trim();
    if (!value) return;
    setAdding(true);
    try {
      if (await onAdd(value)) setEmail('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="新的朋友"
      description="输入邮箱发送好友申请；对方接受后会出现在通讯录。"
      scroll
      maxHeight="85%"
    >
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Input
          size="sm"
          value={email}
          onChangeText={setEmail}
          placeholder="输入邮箱"
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
          disabled={!email.trim()}
          onPress={() => void add()}
        />
      </View>

      {incoming.length === 0 && outgoing.length === 0 ? (
        <EmptyState icon="user-add-line" title="暂无好友申请" description="添加对方邮箱即可发起" />
      ) : (
        <View style={{ gap: 8 }}>
          {incoming.map((r) => (
            <View
              key={r.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 8,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: t.separator,
              }}
            >
              <Avatar name={r.fromUser.name} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                  {r.fromUser.name}
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {r.message || '请求添加你为联系人'}
                </Text>
              </View>
              <Button
                size="sm"
                fullWidth={false}
                label="接受"
                loading={busyId === r.id}
                onPress={() => onAccept(r)}
              />
              <Button
                size="sm"
                variant="ghost"
                fullWidth={false}
                label="拒绝"
                disabled={busyId === r.id}
                onPress={() => onReject(r)}
              />
            </View>
          ))}
          {outgoing.map((r) => (
            <View
              key={r.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 8,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: t.separator,
              }}
            >
              <Avatar name={r.toUser.name} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" numberOfLines={1}>
                  已向 {r.toUser.name} 发送申请
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  等待对方确认
                </Text>
              </View>
              <Button
                size="sm"
                variant="ghost"
                fullWidth={false}
                label="撤回"
                disabled={busyId === r.id}
                onPress={() => onCancel(r)}
              />
            </View>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}
