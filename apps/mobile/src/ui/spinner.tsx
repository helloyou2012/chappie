/**
 * 加载指示：统一颜色与尺寸。
 */
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export function Spinner({
  size = 'small',
  inline = false,
}: {
  size?: 'small' | 'large';
  inline?: boolean;
}) {
  const t = useTheme();
  if (inline) return <ActivityIndicator size={size} color={t.primary} />;
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
      <ActivityIndicator size={size} color={t.primary} />
    </View>
  );
}
