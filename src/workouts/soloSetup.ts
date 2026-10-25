import { DEFAULT_WORKOUT_CONFIG, WORKOUT_MODES, type WorkoutConfig } from './workoutModes';

export const SOLO_TIME = { min: 15, max: 300, step: 15 } as const;
export const SOLO_REPS = { min: 5, max: 100, step: 5 } as const;
export function validSoloLimit(
  value: unknown,
  range: typeof SOLO_TIME | typeof SOLO_REPS,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= range.min &&
    value <= range.max &&
    value % range.step === 0
  );
}
export function createSoloConfig(durationSeconds?: number, targetReps?: number): WorkoutConfig {
  const duration = validSoloLimit(durationSeconds, SOLO_TIME) ? durationSeconds : undefined;
  const reps = validSoloLimit(targetReps, SOLO_REPS) ? targetReps : undefined;
  if (duration === undefined && reps === undefined) return { ...DEFAULT_WORKOUT_CONFIG };
  const preset = WORKOUT_MODES.find(
    (mode) => mode.durationSeconds === duration && mode.targetReps === reps,
  );
  if (preset) return { ...preset };
  return {
    mode: 'custom',
    label: [duration === undefined ? '' : `${duration}s`, reps === undefined ? '' : `${reps} reps`]
      .filter(Boolean)
      .join(' · '),
    ...(duration === undefined ? {} : { durationSeconds: duration }),
    ...(reps === undefined ? {} : { targetReps: reps }),
  };
}
