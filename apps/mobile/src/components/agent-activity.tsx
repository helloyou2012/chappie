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
  /** 摘要行对齐：自己的消息靠右 */
  align?: 'left' | 'right';
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

/**
 * Agent 活动时间线：思考 + 工具调用（仅在主人视角可见）。
 *
 * 默认只显示一行摘要，避免每条 AI 消息上方堆一大块工具细节；
 * 流式处理期间自动展开，结束后自动收起。
 */
export function AgentActivityPanel({
  thinking,
  activity,
  streaming,
  align = 'left',
}: AgentActivityProps) {
  const t = useTheme();
  const [open, setOpen] = useState(streaming);

  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);

  if (!thinking && activity.length === 0) return null;

  const tools = activity.filter((a) => a.kind === 'tool');
  const toolTitles = tools
    .map((a) => a.title)
    .filter(Boolean)
    .slice(0, 2)
    .join('、');
  const summary =
    tools.length > 0
      ? `${tools.length} 次工具调用${toolTitles ? ` · ${toolTitles}` : ''}`
      : '思考过程';

  return (
    <View style={{ marginBottom: 6, alignSelf: 'stretch' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${summary}，${open ? '收起' : '展开'}`}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((v) => !v);
        }}
        style={({ pressed }) => ({
          alignSelf: align === 'right' ? 'flex-end' : 'flex-start',
          maxWidth: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 8,
          backgroundColor: pressed ? t.surfaceHover : t.surfaceRaised,
        })}
      >
        <Icon
          name={streaming ? 'loader-4-line' : 'sparkling-line'}
          size={13}
          color={streaming ? t.primary : t.textMuted}
        />
        <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
          {summary}
        </Text>
        <Icon
          name={open ? 'arrow-up-s-line' : 'arrow-down-s-line'}
          size={12}
          color={t.textTertiary}
        />
      </Pressable>

      {open ? (
        <View style={{ marginTop: 6, gap: 6 }}>
          {thinking ? (
            <View
              style={{
                backgroundColor: t.surfaceRaised,
                borderRadius: 8,
                paddingHorizontal: 9,
                paddingVertical: 7,
              }}
            >
              <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                <Text variant="micro" tone="muted" style={{ lineHeight: 17 }}>
                  {thinking}
                  {streaming ? <BlinkingCursor color={t.primary} /> : null}
                </Text>
              </ScrollView>
            </View>
          ) : null}

          {activity.map((item, index) => {
            // 工具活动可能同名，标题 + 索引是唯一稳定标识
            const key = `${item.title}-${index}`;
            return (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                <Icon
                  name={toolIcon(item.toolId)}
                  size={13}
                  color={item.status === 'failed' ? t.danger : t.textMuted}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="micro" style={{ fontWeight: '600' }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.detail ? (
                    <Text variant="micro" tone="muted" numberOfLines={2} style={{ marginTop: 1 }}>
                      {item.detail}
                    </Text>
                  ) : null}
                </View>
                {item.status === 'running' ? (
                  <Icon name="loader-4-line" size={12} color={t.primary} />
                ) : item.status === 'failed' ? (
                  <Icon name="error-warning-line" size={12} color={t.danger} />
                ) : item.status === 'done' ? (
                  <Icon name="check-line" size={12} color={t.success} />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
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
