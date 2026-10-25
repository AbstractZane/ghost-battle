import { createContext, useContext } from 'react';
import type { CueOptions, SoundCue } from './SoundEffectsEngine';
export interface SoundEffects {
  play(cue: SoundCue, options?: CueOptions): void;
  unlock(): void;
  stopScope(scope: string): void;
  stop(): void;
}
export const SoundContext = createContext<SoundEffects>({
  play() {},
  unlock() {},
  stopScope() {},
  stop() {},
});
export const useSoundEffects = () => useContext(SoundContext);
