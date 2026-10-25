import type { WorkoutSession } from '@/types/models';

export function createGhostTimeline(session: WorkoutSession): number[] {
  const startedAt = Date.parse(session.startedAt);
  let cumulative = 0;
  return session.reps.map((rep) => {
    cumulative += Math.max(0, rep.durationMs);
    const relative = rep.timestamp - startedAt;
    return Number.isFinite(relative) && relative >= 0 && relative <= session.durationSeconds * 2_000
      ? relative
      : cumulative;
  });
}

export function ghostScoreAt(repTimesMs: ReadonlyArray<number>, elapsedMs: number): number {
  return repTimesMs.filter((timestamp) => timestamp <= elapsedMs).length;
}
