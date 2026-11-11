import { useAuthStore } from '@chappie/shared';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export default function Index() {
  const status = useAuthStore((s) => s.status);
  const t = useTheme();

  if (status === 'init') {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}
      >
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }
  return <Redirect href={status === 'ready' ? '/(tabs)' : '/login'} />;
}
