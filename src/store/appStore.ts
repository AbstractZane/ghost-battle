import { create } from 'zustand';
import { createDefaultProfile, DEFAULT_SETTINGS } from '@/constants/defaults';
import type { AppSettings, WorkoutSession } from '@/types/models';
import { ghostPersistence } from '@/creator/ghostPersistence';
interface State {
  status: 'idle' | 'loading' | 'ready' | 'error';
  settings: AppSettings;
  profile: ReturnType<typeof createDefaultProfile>;
  unlockedAchievements: string[];
  hydrate(): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  completeWorkout(
    session: WorkoutSession,
  ): Promise<{ inserted: boolean; previousLifetimeXP: number; newAchievementIds: string[] }>;
}
let writes: Promise<void> = Promise.resolve();
export const useAppStore = create<State>((set, get) => ({
  status: 'idle',
  settings: { ...DEFAULT_SETTINGS },
  profile: createDefaultProfile(),
  unlockedAchievements: [],
  async hydrate() {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    try {
      const raw = await ghostPersistence.read('ghost_settings_v1');
      const saved: unknown = raw ? JSON.parse(raw) : null;
      const settings = { ...DEFAULT_SETTINGS };
      if (saved && typeof saved === 'object') {
        const value = saved as Partial<AppSettings>;
        for (const key of [
          'soundEffectsEnabled',
          'reducedMotion',
          'haptics',
          'skeletonOverlay',
        ] as const)
          if (typeof value[key] === 'boolean') settings[key] = value[key];
        if (value.preferredCamera === 'front' || value.preferredCamera === 'back')
          settings.preferredCamera = value.preferredCamera;
      }
      set({ settings, status: 'ready' });
    } catch {
      set({ status: 'error' });
    }
  },
  updateSettings(patch) {
    const next = writes
      .catch(() => undefined)
      .then(async () => {
        const settings = { ...get().settings, ...patch };
        await ghostPersistence.write('ghost_settings_v1', JSON.stringify(settings));
        set({ settings });
      });
    writes = next;
    return next;
  },
  completeWorkout() {
    return Promise.reject(new Error('Ghost Battle does not award PushPVP account XP.'));
  },
}));
