/**
 * 开关：统一主题色的 Switch 包装。
 */
import { Switch } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export function Toggle({
  value,
  onValueChange,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: t.border, true: t.primary }}
      thumbColor={t.card}
      ios_backgroundColor={t.border}
    />
  );
}
