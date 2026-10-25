import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, motion } from '@/constants/theme';

// Conservative outside the app root, while preference loads, or on API failure.
const ReducedInteractionMotion = createContext(true);

export function InteractionMotionProvider({
  reducedMotion,
  children,
}: PropsWithChildren<{ reducedMotion: boolean }>) {
  const [systemReduced, setSystemReduced] = useState(true);
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true;
      if (mounted) setSystemReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted && !changed) setSystemReduced(value);
      })
      .catch(() => {
        /* Unknown preference keeps decoration disabled. */
      });
    const updateForeground = () => {
      if (mounted)
        setForeground(
          (AppState.currentState == null || AppState.currentState === 'active') &&
            (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden),
        );
    };
    updateForeground();
    const app = AppState.addEventListener('change', updateForeground);
    if (Platform.OS === 'web' && typeof document !== 'undefined')
      document.addEventListener('visibilitychange', updateForeground);
    return () => {
      mounted = false;
      preference?.remove();
      app?.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', updateForeground);
    };
  }, []);
  return (
    <ReducedInteractionMotion.Provider value={reducedMotion || systemReduced || !foreground}>
      {children}
    </ReducedInteractionMotion.Provider>
  );
}

export function useReducedInteractionMotion() {
  return useContext(ReducedInteractionMotion);
}

/** Interruptible decoration; the caller's selected/expanded/pressed state is immediate. */
export function useInteractionTransition(target: number, duration: number = motion.pressMs) {
  const reduced = useReducedInteractionMotion();
  const value = useRef(new Animated.Value(target)).current;
  const previous = useRef(target);
  useEffect(() => {
    if (reduced || previous.current === target) {
      value.stopAnimation();
      value.setValue(target);
      previous.current = target;
      return;
    }
    previous.current = target;
    const animation = Animated.timing(value, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [duration, reduced, target, value]);
  return value;
}

/** Retains the full label/target layout, animating only its decorative underline. */
export function SelectionIndicator({ selected }: { selected: boolean }) {
  const progress = useInteractionTransition(selected ? 1 : 0, motion.hoverMs);
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      aria-hidden
      style={[
        styles.indicator,
        {
          opacity: progress,
          transform: [
            { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) },
          ],
        },
      ]}
    />
  );
}

export function RevealContent({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const reduced = useReducedInteractionMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const revealed = useRef(false);
  useEffect(() => {
    if (reduced || revealed.current) {
      progress.stopAnimation();
      progress.setValue(1);
      revealed.current = true;
      return;
    }
    revealed.current = true;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.contentMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primaryBright,
  },
});
