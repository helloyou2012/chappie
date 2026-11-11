import { useColorScheme } from 'react-native';
import { colors, darkColors, type ThemeColors } from '@/theme';

export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkColors : colors;
}
