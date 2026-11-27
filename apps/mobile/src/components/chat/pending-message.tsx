import { contentText } from '@chappie/contract';
import { formatTime, type PendingMessage } from '@chappie/shared';
import { ActivityIndicator, Image, View } from 'react-native';
import Icon from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '@/ui';

/** 本地待发消息：上传中 / 发送中，图片先用本地预览。 */
export function PendingMessageBubble({ pending }: { pending: PendingMessage }) {
  const t = useTheme();
  const pc = pending.content;
  const uploading = pending.status === 'uploading';
  return (
    <View style={{ alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 }}>
        <Text variant="micro" tone="muted">
          我 · {formatTime(pending.createdAt)} · {uploading ? '上传中' : '发送中'}
        </Text>
        <ActivityIndicator size="small" color={t.textMuted} />
      </View>
      {pc.type === 'image' ? (
        <View
          style={{
            position: 'relative',
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: t.surfaceRaised,
          }}
        >
          {pc.url ? (
            <Image
              source={{ uri: pc.url }}
              style={{
                width: 220,
                height:
                  pc.width && pc.height
                    ? Math.min(280, Math.round((220 * pc.height) / pc.width))
                    : 160,
                opacity: uploading ? 0.7 : 1,
              }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{ width: 220, height: 160, alignItems: 'center', justifyContent: 'center' }}
            >
              <ActivityIndicator color={t.primary} />
            </View>
          )}
          {uploading ? (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.25)',
              }}
            >
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
      ) : pc.type === 'file' ? (
        <View
          style={{
            width: 260,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderRadius: 12,
            backgroundColor: t.primary,
            padding: 10,
          }}
        >
          <Icon name="file-text-line" size={20} color={t.primaryFg} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: t.primaryFg, fontWeight: '600' }}
            >
              {pc.name ?? '文件'}
            </Text>
            {typeof pc.size === 'number' ? (
              <Text variant="micro" style={{ color: t.primaryFg, opacity: 0.8 }}>
                {formatBytes(pc.size)}
              </Text>
            ) : null}
          </View>
          {uploading ? <ActivityIndicator color={t.primaryFg} /> : null}
        </View>
      ) : (
        <View
          style={{
            backgroundColor: t.primary,
            borderRadius: 16,
            paddingHorizontal: 13,
            paddingVertical: 9,
            maxWidth: '82%',
          }}
        >
          <Text style={{ fontSize: 15, color: t.primaryFg }}>{contentText(pc)}</Text>
        </View>
      )}
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
