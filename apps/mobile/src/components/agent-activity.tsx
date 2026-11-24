import type { AgentActivityItem } from '@chappie/contract';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  UIManager,
  View,
} from 'react-native';
import Icon, { type IconName } from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '@/ui';

// Android 旧架构需要显式开启 LayoutAnimation（新架构为 no-op）
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AgentActivityProps {
  thinking: string;
  activity: AgentActivityItem[];
  streaming: boolean;
}

function toolIcon(toolId?: string): IconName {
  if (!toolId) return 'tools-line';
  if (toolId.startsWith('calendar')) return 'calendar-line';
  if (toolId.startsWith('todo')) return 'checkbox-multiple-line';
  if (toolId === 'web.search') return 'search-line';
  if (toolId === 'translate') return 'translate-2';
  if (toolId === 'summarize') return 'file-text-line';
  if (toolId === 'payment.send') return 'wallet-3-line';
  return 'tools-line';
}

function firstLine(text: string, max = 42): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Agent 活动时间线：思考 + 工具调用（仅在主人视角可见） */
export function AgentActivityPanel({ thinking, activity, streaming }: AgentActivityProps) {
  const t = useTheme();
  const [groupOpen, setGroupOpen] = useState(true);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const toolCount = activity.filter((a) => a.kind === 'tool').length;

  if (!thinking && activity.length === 0) return null;

  const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  const rowOpen = (key: string, fallback = false) => openRows[key] ?? fallback;
  const toggleRow = (key: string, fallback = false) => {
    animate();
    setOpenRows((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }));
  };

  const rows = [
    ...(thinking
      ? [
          {
            key: 'thinking',
            title: '思考',
            detail: firstLine(thinking),
            content: thinking,
            status: streaming ? 'running' : 'done',
            icon: 'sparkling-line',
            mono: false,
            fallbackOpen: streaming,
          },
        ]
      : []),
    ...activity.map((item, index) => ({
      key: `tool-${index}`,
      title: item.title,
      detail: item.detail,
      content: item.content,
      status: item.status,
      icon: toolIcon(item.toolId),
      mono: true,
      fallbackOpen: false,
    })),
  ];

  // 只有一个条目：不做二级分组，但这一行本身可以收起（默认展开）
  if (rows.length === 1) {
    const row = rows[0]!;
    // thinking: 流式时展开，完成后自动收起；tool call: 默认收起
    const open = rowOpen(row.key, row.fallbackOpen);
    return (
      <View style={{ width: '100%', marginBottom: 4 }}>
        <Pressable
          onPress={() => toggleRow(row.key, row.fallbackOpen)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 }}
        >
          <Icon
            name={open ? 'arrow-down-s-line' : 'arrow-right-s-line'}
            size={12}
            color={t.textMuted}
          />
          <Icon
            name={row.icon as IconName}
            size={13}
            color={row.icon === 'sparkling-line' ? t.primary : t.textMuted}
          />
          <Text variant="caption" style={{ fontWeight: '600' }} numberOfLines={1}>
            {row.title}
          </Text>
          {row.detail ? (
            <View
              style={{
                maxWidth: '52%',
                borderRadius: 6,
                backgroundColor: t.surfaceHover,
                paddingHorizontal: 6,
                paddingVertical: 1,
              }}
            >
              <Text variant="micro" tone="muted" numberOfLines={1}>
                {row.detail}
              </Text>
            </View>
          ) : null}
          {row.status === 'running' ? (
            <View style={{ marginLeft: 'auto' }}>
              <Icon name="loader-4-line" size={12} color={t.primary} />
            </View>
          ) : row.status === 'failed' ? (
            <View style={{ marginLeft: 'auto' }}>
              <Icon name="error-warning-line" size={12} color={t.danger} />
            </View>
          ) : null}
        </Pressable>
        {open ? (
          <View
            style={{
              marginLeft: 6,
              borderLeftWidth: 1,
              borderLeftColor: t.border,
              paddingLeft: 8,
              paddingVertical: 2,
            }}
          >
            <ScrollView style={{ maxHeight: 200 }}>
              <Text
                variant="caption"
                tone="muted"
                style={{
                  lineHeight: 17,
                  fontFamily: row.mono
                    ? Platform.select({ ios: 'Menlo', android: 'monospace' })
                    : undefined,
                }}
              >
                {row.content}
                {row.status === 'running' ? <BlinkingCursor color={t.primary} /> : null}
              </Text>
            </ScrollView>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ width: '100%', marginBottom: 4 }}>
      <Pressable
        onPress={() => {
          animate();
          setGroupOpen((v) => !v);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 }}
      >
        <Icon
          name={groupOpen ? 'arrow-down-s-line' : 'arrow-right-s-line'}
          size={14}
          color={t.textMuted}
        />
        <Text variant="caption" tone="muted">
          {toolCount > 0 ? `${toolCount} 次工具调用` : '思考过程'}
          {toolCount > 0 && thinking ? ' · 思考' : ''}
        </Text>
        {streaming ? (
          <Text variant="micro" tone="muted">
            进行中…
          </Text>
        ) : null}
      </Pressable>

      {groupOpen
        ? rows.map((row) => {
            const open = rowOpen(row.key, row.fallbackOpen);
            return (
              <View key={row.key} style={{ marginTop: 2 }}>
                <Pressable
                  onPress={() => toggleRow(row.key, row.fallbackOpen)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 }}
                >
                  <Icon
                    name={open ? 'arrow-down-s-line' : 'arrow-right-s-line'}
                    size={12}
                    color={t.textMuted}
                  />
                  <Icon
                    name={row.icon as IconName}
                    size={13}
                    color={row.icon === 'sparkling-line' ? t.primary : t.textMuted}
                  />
                  <Text variant="caption" style={{ fontWeight: '600' }} numberOfLines={1}>
                    {row.title}
                  </Text>
                  {row.detail ? (
                    <View
                      style={{
                        maxWidth: '52%',
                        borderRadius: 6,
                        backgroundColor: t.surfaceHover,
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                      }}
                    >
                      <Text variant="micro" tone="muted" numberOfLines={1}>
                        {row.detail}
                      </Text>
                    </View>
                  ) : null}
                  {row.status === 'running' ? (
                    <View style={{ marginLeft: 'auto' }}>
                      <Icon name="loader-4-line" size={12} color={t.primary} />
                    </View>
                  ) : row.status === 'failed' ? (
                    <View style={{ marginLeft: 'auto' }}>
                      <Icon name="error-warning-line" size={12} color={t.danger} />
                    </View>
                  ) : null}
                </Pressable>
                {open ? (
                  <View
                    style={{
                      marginLeft: 6,
                      borderLeftWidth: 1,
                      borderLeftColor: t.border,
                      paddingLeft: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <ScrollView style={{ maxHeight: 200 }}>
                      <Text
                        variant="caption"
                        tone="muted"
                        style={{
                          lineHeight: 17,
                          fontFamily: row.mono
                            ? Platform.select({ ios: 'Menlo', android: 'monospace' })
                            : undefined,
                        }}
                      >
                        {row.content}
                        {row.status === 'running' ? <BlinkingCursor color={t.primary} /> : null}
                      </Text>
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );
}

function BlinkingCursor({ color }: { color?: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.15,
          duration: 450,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 450,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={{ color, opacity }}>▍</Animated.Text>;
}
