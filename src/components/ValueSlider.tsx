import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/constants/theme';

export interface ValueSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  valueText: string;
  disabled?: boolean;
  onChange(value: number): void;
}
export function ValueSlider({
  value,
  min,
  max,
  step,
  label,
  valueText,
  disabled,
  onChange,
}: ValueSliderProps) {
  const [width, setWidth] = useState(1);
  const position = (value - min) / (max - min);
  const change = (next: number) => {
    if (!disabled)
      onChange(Math.max(min, Math.min(max, min + Math.round((next - min) / step) * step)));
  };
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: valueText }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        change(value + (event.nativeEvent.actionName === 'increment' ? step : -step))
      }
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderGrant={(event) =>
        change(min + (event.nativeEvent.locationX / width) * (max - min))
      }
      onResponderMove={(event) => change(min + (event.nativeEvent.locationX / width) * (max - min))}
      style={[styles.area, disabled && styles.disabled]}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${position * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${position * 100}%` }]} />
    </View>
  );
}
const styles = StyleSheet.create({
  area: { height: 44, marginHorizontal: 12, justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  track: { height: 6, borderRadius: 6, backgroundColor: colors.borderStrong },
  fill: { height: 6, borderRadius: 6, backgroundColor: colors.primary },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: -12,
    backgroundColor: '#E9DFFE',
    borderWidth: 5,
    borderColor: colors.primary,
  },
});
