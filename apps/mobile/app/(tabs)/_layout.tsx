import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import Icon, { type IconName } from 'react-native-remix-icon';
import { useTheme } from '@/hooks/use-theme';

function TabIcon({ name, color }: { name: IconName; color: ColorValue }) {
  return <Icon name={name} size={22} color={color as string} />;
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '消息',
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
        name="avatar"
        options={{
          title: '分身',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'robot-2-fill' : 'robot-2-line'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: '日报',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name={focused ? 'calendar-fill' : 'calendar-line'} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
