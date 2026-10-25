import React, { useEffect, useRef, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import { useAppStore } from '@/store/appStore';
import { SoundEffectsEngine } from './SoundEffectsEngine';
import { createSoundTransport } from './soundTransport';
import { SoundContext, type SoundEffects } from './SoundEffectsContext';

export function SoundEffectsProvider({ children }: PropsWithChildren) {
  const status = useAppStore((s) => s.status);
  const enabled = useAppStore((s) => s.settings.soundEffectsEnabled);
  const volume = useAppStore((s) => s.settings.soundEffectsVolume);
  const engine = useRef<SoundEffectsEngine | null>(null);
  const latest = useRef({ enabled, volume });
  latest.current = { enabled, volume };
  const api = useRef<SoundEffects>({
    play: (cue, options) => engine.current?.play(cue, options),
    unlock: () => engine.current?.unlock(),
    stopScope: (scope) => engine.current?.stopScope(scope),
    stop: () => engine.current?.stop(),
  }).current;
  useEffect(() => {
    if (status !== 'ready') return;
    let mounted = true;
    const isForeground = () =>
      (AppState.currentState == null || AppState.currentState === 'active') &&
      (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden);
    void createSoundTransport()
      .then((transport) => {
        if (!mounted) {
          transport.dispose();
          return;
        }
        engine.current = new SoundEffectsEngine(transport);
        engine.current.configure(latest.current.enabled, latest.current.volume);
        engine.current.setForeground(isForeground());
      })
      .catch(() => {
        /* Old clients and unsupported browsers remain fully usable without audio. */
      });
    const change = () => engine.current?.setForeground(isForeground());
    const subscription = AppState.addEventListener('change', change);
    const unlock = () => engine.current?.unlock();
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', change);
      document.addEventListener('pointerdown', unlock, { passive: true });
      document.addEventListener('keydown', unlock);
    }
    // Only new achievements after hydration. Initial history never plays reward sounds.
    let achievementCount = useAppStore.getState().unlockedAchievements.length;
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.unlockedAchievements.length > achievementCount)
        engine.current?.play('achievement', {
          eventKey: String(state.unlockedAchievements.length),
        });
      achievementCount = state.unlockedAchievements.length;
    });
    return () => {
      mounted = false;
      subscription.remove();
      unsubscribe();
      engine.current?.dispose();
      engine.current = null;
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', change);
        document.removeEventListener('pointerdown', unlock);
        document.removeEventListener('keydown', unlock);
      }
    };
  }, [status]);
  useEffect(() => {
    engine.current?.configure(enabled, volume);
  }, [enabled, volume]);
  return <SoundContext.Provider value={api}>{children}</SoundContext.Provider>;
}
