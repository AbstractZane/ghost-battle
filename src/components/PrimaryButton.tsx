import React, { type ReactNode, useEffect, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SoundPressable as Pressable } from '@/components/SoundPressable';

import { colors, motion, radius, spacing, typography } from '@/constants/theme';
import { useInteractionTransition, useReducedInteractionMotion } from './InteractionMotion';
import { useCompactWebLayout } from './useCompactWebLayout';
import type { SoundCue } from '@/audio/SoundEffectsEngine';

interface PrimaryButtonProps {
  soundCue?: SoundCue | false;
  label: string;
  accessibilityLabel?: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  compact?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  /** Hides visible text only; label remains the accessible action name. */
  iconOnly?: boolean;
  style?: StyleProp<ViewStyle>;
  selected?: boolean;
  expanded?: boolean;
}

export function PrimaryButton({
  soundCue = 'press',
  label,
  accessibilityLabel,
  onPress,
  variant = 'primary',
  compact = false,
  disabled = false,
  loading = false,
  icon,
  iconOnly = false,
  style,
  selected,
  expanded,
}: PrimaryButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const reducedMotion = useReducedInteractionMotion();
  const { compact: compactWeb } = useCompactWebLayout();
  const unavailable = disabled || loading;
  const scale = useInteractionTransition(pressed && !unavailable && !reducedMotion ? 0.975 : 1);
  useEffect(() => {
    if (unavailable || reducedMotion) setPressed(false);
  }, [unavailable, reducedMotion]);

  return (
    <Pressable
      soundCue={soundCue}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: loading, disabled: unavailable, selected, expanded }}
      aria-busy={loading}
      aria-disabled={unavailable}
      aria-selected={selected}
      aria-expanded={expanded}
      disabled={unavailable}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onHoverIn={() => {
        if (!unavailable) setHovered(true);
      }}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        compactWeb && styles.compactWeb,
        Platform.OS === 'web' && webButton,
        Platform.OS === 'web' && reducedMotion && webReducedMotion,
        styles[variant],
        hovered && !unavailable && variant === 'primary' && styles.primaryHovered,
        hovered &&
          !unavailable &&
          (variant === 'secondary' || variant === 'quiet') &&
          styles.secondaryHovered,
        hovered && !unavailable && !reducedMotion && styles.hoveredMotion,
        focused && styles.focused,
        focused && Platform.OS === 'web' && webFocused,
        pressed && !unavailable && styles.pressed,
        unavailable && styles.disabled,
        unavailable && Platform.OS === 'web' && webDisabled,
        style,
      ]}
    >
      <Animated.View style={[styles.content, { transform: [{ scale }] }]}>
        {loading ? (
          <ActivityIndicator
            color={variant === 'primary' || variant === 'danger' ? colors.background : colors.white}
            size="small"
          />
        ) : (
          icon
        )}
        {!iconOnly ? (
          <Text
            style={[
              styles.label,
              variant !== 'primary' && variant !== 'danger' && styles.lightLabel,
            ]}
          >
            {label}
          </Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.smd,
    borderWidth: 1,
    borderColor: colors.transparent,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primary: { backgroundColor: colors.primary },
  compact: { minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  compactWeb: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  primaryHovered: { backgroundColor: colors.primaryBright },
  secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  secondaryHovered: { backgroundColor: colors.surfaceStrong, borderColor: colors.borderStrong },
  danger: { backgroundColor: colors.danger },
  quiet: { backgroundColor: colors.transparent, borderColor: colors.border },
  label: { ...typography.label, color: colors.background, flexShrink: 1, textAlign: 'center' },
  lightLabel: { color: colors.white },
  hoveredMotion: { transform: [{ translateY: -1 }] },
  focused: { borderColor: colors.primaryBright },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.42 },
});

const webButton = {
  cursor: 'pointer',
  transitionDuration: `${motion.hoverMs}ms`,
  transitionProperty: 'background-color, border-color, opacity, transform',
  transitionTimingFunction: 'ease-out',
} as unknown as ViewStyle;

const webFocused = {
  outlineStyle: 'none',
  boxShadow: `0 0 0 3px ${colors.primaryMuted}`,
} as unknown as ViewStyle;

const webDisabled = { cursor: 'not-allowed' } as unknown as ViewStyle;
const webReducedMotion = { transitionDuration: '0ms' } as unknown as ViewStyle;
