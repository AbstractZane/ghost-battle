export type WorkoutModeId =
  | 'free'
  | 'timed-30'
  | 'timed-60'
  | 'timed-120'
  | 'max-reps'
  | 'first-25'
  | 'first-50'
  | 'ghost'
  | 'custom';

export type StartDelaySeconds = 3 | 5 | 10;

export interface WorkoutConfig {
  mode: WorkoutModeId;
  label: string;
  durationSeconds?: number;
  targetReps?: number;
  ghostRepTimesMs?: number[];
  autoStart?: boolean;
  startDelaySeconds?: StartDelaySeconds;
}

export const WORKOUT_MODES: ReadonlyArray<WorkoutConfig> = [
  { mode: 'free', label: 'Free Workout' },
  { mode: 'timed-30', label: '30 Seconds', durationSeconds: 30 },
  { mode: 'timed-60', label: '60 Seconds', durationSeconds: 60 },
  { mode: 'timed-120', label: '2 Minutes', durationSeconds: 120 },
  { mode: 'max-reps', label: 'Max Reps' },
  { mode: 'first-25', label: 'First to 25', targetReps: 25 },
  { mode: 'first-50', label: 'First to 50', targetReps: 50 },
];

export const DEFAULT_WORKOUT_CONFIG = WORKOUT_MODES[0] as WorkoutConfig;

export function workoutComplete(
  config: WorkoutConfig,
  elapsedSeconds: number,
  reps: number,
): boolean {
  return (
    (config.durationSeconds !== undefined && elapsedSeconds >= config.durationSeconds) ||
    (config.targetReps !== undefined && reps >= config.targetReps)
  );
}

export function workoutClock(config: WorkoutConfig, elapsedSeconds: number): number {
  return config.durationSeconds === undefined
    ? elapsedSeconds
    : Math.max(0, config.durationSeconds - elapsedSeconds);
}
