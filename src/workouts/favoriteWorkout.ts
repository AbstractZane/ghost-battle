import type { WorkoutSession } from '@/types/models';
import { createSoloConfig, SOLO_TIME, SOLO_REPS, validSoloLimit } from './soloSetup';
import { createGhostTimeline } from './ghostBattle';
import {
  WORKOUT_MODES,
  type StartDelaySeconds,
  type WorkoutConfig,
  type WorkoutModeId,
} from './workoutModes';

/** Device-local preferences only: no video, landmarks, rewards or inferred performance. */
export interface FavoriteWorkoutSetup {
  version: 1;
  mode: WorkoutModeId;
  autoStart: boolean;
  startDelaySeconds: StartDelaySeconds;
  ghostWorkoutId?: string;
  durationSeconds?: number;
  targetReps?: number;
}

export function parseFavoriteWorkout(value: unknown): FavoriteWorkoutSetup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const mode =
    WORKOUT_MODES.find((item) => item.mode === row.mode)?.mode ??
    (row.mode === 'ghost' ? 'ghost' : row.mode === 'custom' ? 'custom' : null);
  if (
    row.version !== 1 ||
    !mode ||
    typeof row.autoStart !== 'boolean' ||
    (row.startDelaySeconds !== 3 && row.startDelaySeconds !== 5 && row.startDelaySeconds !== 10)
  )
    return null;
  if (
    mode === 'custom' &&
    ((row.durationSeconds === undefined && row.targetReps === undefined) ||
      (row.durationSeconds !== undefined && !validSoloLimit(row.durationSeconds, SOLO_TIME)) ||
      (row.targetReps !== undefined && !validSoloLimit(row.targetReps, SOLO_REPS)))
  )
    return null;
  if (
    mode === 'ghost' &&
    (typeof row.ghostWorkoutId !== 'string' ||
      row.ghostWorkoutId.length === 0 ||
      row.ghostWorkoutId.length > 200)
  )
    return null;
  return {
    version: 1,
    mode,
    autoStart: row.autoStart,
    startDelaySeconds: row.startDelaySeconds,
    ...(mode === 'ghost' ? { ghostWorkoutId: row.ghostWorkoutId as string } : {}),
    ...(mode === 'custom' && row.durationSeconds !== undefined
      ? { durationSeconds: row.durationSeconds as number }
      : {}),
    ...(mode === 'custom' && row.targetReps !== undefined
      ? { targetReps: row.targetReps as number }
      : {}),
  };
}

export function favoriteFromConfig(
  config: WorkoutConfig,
  ghostWorkoutId?: string,
): FavoriteWorkoutSetup | null {
  return parseFavoriteWorkout({
    version: 1,
    mode: config.mode,
    autoStart: config.autoStart,
    startDelaySeconds: config.startDelaySeconds,
    ghostWorkoutId,
    ...(config.mode === 'custom'
      ? { durationSeconds: config.durationSeconds, targetReps: config.targetReps }
      : {}),
  });
}

/** Rebuild canonical mode settings, never trust stored labels, timers or rep targets. */
export function resolveFavoriteWorkout(
  value: unknown,
  workouts: readonly WorkoutSession[],
): WorkoutConfig | null {
  const saved = parseFavoriteWorkout(value);
  if (!saved) return null;
  const start = { autoStart: saved.autoStart, startDelaySeconds: saved.startDelaySeconds };
  if (saved.mode === 'custom')
    return { ...createSoloConfig(saved.durationSeconds, saved.targetReps), ...start };
  if (saved.mode !== 'ghost') {
    const mode = WORKOUT_MODES.find((item) => item.mode === saved.mode);
    return mode ? { ...mode, ...start } : null;
  }
  const source = workouts.find((item) => item.id === saved.ghostWorkoutId);
  if (
    !source ||
    source.exercise !== 'pushup' ||
    !Number.isFinite(source.durationSeconds) ||
    source.durationSeconds < 0 ||
    !Number.isSafeInteger(source.validReps) ||
    source.validReps < 0 ||
    !Number.isFinite(Date.parse(source.startedAt)) ||
    !Array.isArray(source.reps) ||
    source.validReps > source.reps.length ||
    source.reps.some(
      (rep) =>
        !rep ||
        !Number.isFinite(rep.timestamp) ||
        !Number.isFinite(rep.durationMs) ||
        rep.durationMs < 0,
    )
  )
    return null;
  const timeline = createGhostTimeline(source);
  if (timeline.some((time) => !Number.isFinite(time) || time < 0)) return null;
  return {
    mode: 'ghost',
    label: `Ghost · ${source.validReps} rep workout`,
    durationSeconds: Math.max(10, source.durationSeconds),
    ghostRepTimesMs: timeline,
    ...start,
  };
}

export function workoutSetupLabel(config: WorkoutConfig): string {
  return `${config.label} · ${config.autoStart ? 'Auto start' : 'Manual start'} · ${config.startDelaySeconds}s countdown`;
}
