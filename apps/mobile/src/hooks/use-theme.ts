import { useColorScheme } from 'react-native';
import { useThemeStore } from '@/store/theme';
import { colors, darkColors, type ThemeColors } from '@/theme';

/** 解析后的实际明暗（system 模式下跟随系统）。 */
export function useResolvedScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  const mode = useThemeStore((s) => s.mode);
  if (mode === 'light' || mode === 'dark') return mode;
  return scheme === 'dark' ? 'dark' : 'light';
}

export function useTheme(): ThemeColors {
  return useResolvedScheme() === 'dark' ? darkColors : colors;
}
