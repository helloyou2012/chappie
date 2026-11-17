// uuid 包在 RN 依赖 crypto.getRandomValues，必须先加载 polyfill
import 'react-native-get-random-values';
import { setDefaultServerUrls, setStorageAdapter, useAuthStore } from '@chappie/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BUILD_ADMIN_URL, BUILD_SERVER_URL } from '../src/config';
import { useResolvedScheme } from '../src/hooks/use-theme';
import { resumeRealtime } from '../src/realtime';
import { useThemeStore } from '../src/store/theme';

// React Native 存储适配器（Web 用 localStorage）
setStorageAdapter(AsyncStorage);
// 生产构建的服务地址由 EXPO_PUBLIC_* 固定；本地保存过的地址优先
setDefaultServerUrls(BUILD_SERVER_URL, BUILD_ADMIN_URL);

export default function RootLayout() {
  const restore = useAuthStore((s) => s.restore);
  const restoreTheme = useThemeStore((s) => s.restore);
  const scheme = useResolvedScheme();

  useEffect(() => {
    void restore();
    void restoreTheme();
  }, [restore, restoreTheme]);

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
