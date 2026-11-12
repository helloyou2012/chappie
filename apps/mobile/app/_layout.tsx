// uuid 包在 RN 依赖 crypto.getRandomValues，必须先加载 polyfill
import 'react-native-get-random-values';
import { setStorageAdapter, useAuthStore } from '@chappie/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { resumeRealtime } from '../src/realtime';

// React Native 存储适配器（Web 用 localStorage）
setStorageAdapter(AsyncStorage);

export default function RootLayout() {
  const restore = useAuthStore((s) => s.restore);
  const scheme = useColorScheme();

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    // 移动端前台恢复：连接断开则重连，否则立即重放离线命令队列
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumeRealtime();
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
