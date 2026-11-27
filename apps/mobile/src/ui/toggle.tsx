/**
 * 开关：自绘胶囊轨道 + 白色圆钮，替代各平台样式不一的原生 Switch。
 * 视觉规格：38×22 轨道、18 圆钮、微阴影；减少动效时直接切换。
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

const WIDTH = 38;
const HEIGHT = 22;
const PADDING = 2;
const KNOB = HEIGHT - PADDING * 2;
const TRAVEL = WIDTH - KNOB - PADDING * 2;

export function Toggle({
  value,
  onValueChange,
  disabled = false,
  label,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  /** 无障碍标签：说明这个开关控制什么 */
  label?: string;
}) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(value ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [value, reducedMotion, progress]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={{ padding: PADDING, opacity: disabled ? 0.45 : 1 }}
    >
      <View
        style={{
          width: WIDTH,
          height: HEIGHT,
          borderRadius: HEIGHT / 2,
          backgroundColor: value ? t.primary : t.border,
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={{
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            marginLeft: PADDING,
            backgroundColor: '#ffffff',
            shadowColor: '#000',
            shadowOpacity: 0.16,
            shadowRadius: 1.5,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, TRAVEL],
                }),
              },
            ],
          }}
        />
      </View>
    </Pressable>
  );
}
