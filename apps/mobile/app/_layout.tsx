// uuid 包在 RN 依赖 crypto.getRandomValues，必须先加载 polyfill
import 'react-native-get-random-values';
import { setStorageAdapter, useAuthStore } from '@chappie/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// React Native 存储适配器（Web 用 localStorage）
setStorageAdapter(AsyncStorage);

export default function RootLayout() {
  const restore = useAuthStore((s) => s.restore);
  const scheme = useColorScheme();

  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
