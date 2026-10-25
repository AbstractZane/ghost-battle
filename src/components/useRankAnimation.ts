import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, type View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { useAppStore } from '@/store/appStore';

/** One-shot decoration. App/focus/accessibility changes cancel, never replay it. */
export function useRankAnimation(duration: number, identity: string, delay = 0) {
  const navigation = useContext(NavigationContext);
  const appReducedMotion = useAppStore((state) => state.settings.reducedMotion);
  const container = useRef<View>(null);
  const progress = useRef(new Animated.Value(1)).current;
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const played = useRef<string | null>(null);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const motionAllowed = appReducedMotion ? false : allowed;

  const finish = useCallback(() => {
    played.current = identity;
    animation.current?.stop();
    progress.setValue(1);
    setPlaying(false);
  }, [identity, progress]);

  useEffect(() => {
    let mounted = true;
    let preference: boolean | null = null;
    let preferenceChanged = false;
    let onScreen: boolean | null = true;
    const update = () => {
      if (!mounted) return;
      const foreground = AppState.currentState == null || AppState.currentState === 'active';
      const visible = Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden;
      setAllowed(
        preference === null || onScreen === null
          ? null
          : !preference && foreground && visible && onScreen && (navigation?.isFocused() ?? true),
      );
    };
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      preferenceChanged = true;
      preference = value;
      update();
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!preferenceChanged) preference = value;
        update();
      })
      .catch(() => {
        if (!preferenceChanged) preference = true;
        update();
      });
    const app = AppState.addEventListener('change', update);
    const focus = navigation?.addListener('focus', update);
    const blur = navigation?.addListener('blur', update);
    let observer: IntersectionObserver | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', update);
      if (typeof IntersectionObserver !== 'undefined' && container.current instanceof Element) {
        onScreen = null;
        observer = new IntersectionObserver(
          (entries) => {
            onScreen = entries[0]?.isIntersecting ?? false;
            update();
          },
          { threshold: 0.05 },
        );
        observer.observe(container.current);
      }
    }
    return () => {
      mounted = false;
      motion?.remove();
      app?.remove();
      focus?.();
      blur?.();
      observer?.disconnect();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', update);
      }
    };
  }, [navigation]);

  useEffect(() => {
    if (motionAllowed === null) return;
    if (!motionAllowed || played.current === identity) {
      finish();
      return;
    }
    played.current = identity;
    progress.setValue(0);
    setPlaying(true);
    let mounted = true;
    const sequence = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]);
    animation.current = sequence;
    sequence.start(() => {
      if (mounted) {
        progress.setValue(1);
        setPlaying(false);
      }
    });
    return () => {
      mounted = false;
      sequence.stop();
    };
  }, [motionAllowed, delay, duration, finish, identity, progress]);

  return { progress, playing, finish, container, checkingPreference: motionAllowed === null };
}
