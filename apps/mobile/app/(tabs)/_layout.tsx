import { useChatStore } from '@chappie/shared';
import { Tabs } from 'expo-router';
import { type ColorValue, StyleSheet } from 'react-native';
import Icon, { type IconName } from 'react-native-remix-icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/use-theme';

function TabIcon({ name, color }: { name: IconName; color: ColorValue }) {
  return <Icon name={name} size={24} color={color as string} />;
}

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const totalUnread = useChatStore((s) => s.conversations.reduce((n, c) => n + c.unreadCount, 0));
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarHideOnKeyboard: true,
        // 导航库的默认栏高 49 在 Android/Web 字体行高下装不下「28 图标 + 10 标签」，会裁字。
        // 固定 56 + 安全区，并显式给标签行高，避免不同平台字体度量差异；安全区由库自动加为底部内边距。
        tabBarStyle: {
          backgroundColor: t.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.separator,
          height: 56 + insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 10, lineHeight: 12, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '消息',
          tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? '99+' : totalUnread) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: t.danger,
            fontSize: 9,
            lineHeight: 14,
            minWidth: 16,
            height: 16,
          },
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'chat-3-fill' : 'chat-3-line'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: '审批',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'shield-check-fill' : 'shield-check-line'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: '日程',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'calendar-fill' : 'calendar-line'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="avatar"
        options={{
          title: '分身',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'robot-2-fill' : 'robot-2-line'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'account-circle-fill' : 'account-circle-line'} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
