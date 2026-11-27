import { type Approval, formatRelative } from '@chappie/shared';
import { View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Badge, Button, Text } from '@/ui';

const STATUS: Record<string, { label: string; tone: 'muted' | 'success' | 'warning' | 'danger' }> =
  {
    pending: { label: '待确认', tone: 'warning' },
    approved: { label: '已批准', tone: 'success' },
    modified: { label: '修改后批准', tone: 'success' },
    rejected: { label: '已拒绝', tone: 'danger' },
    expired: { label: '已超时', tone: 'muted' },
  };

/** 审批行：工具 / 参数 / 状态 / 本次批准与拒绝。 */
export function ApprovalRow({
  approval,
  busy,
  onApprove,
  onReject,
}: {
  approval: Approval;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const t = useTheme();
  const pending = approval.status === 'pending';
  const status = STATUS[approval.status] ?? {
    label: approval.status,
    tone: 'muted' as const,
  };
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            backgroundColor: pending ? `${t.warning}1f` : t.surfaceRaised,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="shield-keyhole-line" size={18} color={pending ? t.warning : t.textMuted} />
        </View>
        <Text variant="row" style={{ flex: 1 }} numberOfLines={1}>
          {approval.title}
        </Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      <Text variant="micro" tone="muted" style={{ marginTop: 6 }}>
        工具 {approval.toolName} · {formatRelative(approval.createdAt)}
      </Text>
      <View
        style={{
          backgroundColor: t.surfaceRaised,
          borderRadius: 8,
          padding: 9,
          marginTop: 8,
        }}
      >
        <Text variant="micro" tone="muted" mono numberOfLines={4}>
          {JSON.stringify(approval.args, null, 2)}
        </Text>
      </View>
      <Text variant="micro" tone="tertiary" style={{ marginTop: 6 }}>
        请求 {formatRelative(approval.createdAt)} · 超时 {formatRelative(approval.expiresAt)}
      </Text>
      {pending ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <Button
            size="sm"
            fullWidth={false}
            label="批准（仅本次）"
            loading={busy}
            disabled={!approval.cardMsgId}
            onPress={onApprove}
          />
          <Button
            size="sm"
            variant="outline"
            fullWidth={false}
            label="拒绝"
            disabled={busy || !approval.cardMsgId}
            onPress={onReject}
          />
          <Text variant="micro" tone="muted" align="right" style={{ flex: 1 }} numberOfLines={2}>
            改参数请到分身会话卡片处理
          </Text>
        </View>
      ) : null}
    </View>
  );
}
