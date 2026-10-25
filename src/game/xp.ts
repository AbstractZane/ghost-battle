import type { ExerciseRep } from '@/types/models';

export const XP_ECONOMY = {
  validRep: 1,
  perfectRepBonus: 1,
  workoutCompletion: 10,
  dailyGoalCompletion: 20,
} as const;

export interface WorkoutXPInput {
  reps: ExerciseRep[];
  completed: boolean;
  dailyGoalReachedNow: boolean;
}

export function calculateWorkoutXP(input: WorkoutXPInput): number {
  const base = input.reps.length * XP_ECONOMY.validRep;
  const perfectBonus =
    input.reps.filter((rep) => rep.qualityScore >= 90).length * XP_ECONOMY.perfectRepBonus;
  const completion = input.completed && input.reps.length > 0 ? XP_ECONOMY.workoutCompletion : 0;
  const dailyGoal = input.dailyGoalReachedNow ? XP_ECONOMY.dailyGoalCompletion : 0;
  return base + perfectBonus + completion + dailyGoal;
}

export function calculateLiveXP(reps: ExerciseRep[]): number {
  return reps.reduce(
    (total, rep) =>
      total + XP_ECONOMY.validRep + (rep.qualityScore >= 90 ? XP_ECONOMY.perfectRepBonus : 0),
    0,
  );
}
