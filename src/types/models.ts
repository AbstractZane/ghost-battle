import type { StartDelaySeconds, WorkoutModeId } from '@/workouts/workoutModes';
import type { FavoriteWorkoutSetup } from '@/workouts/favoriteWorkout';
type BossDifficulty = 'gentle' | 'standard' | 'fierce';
type WorldId = string;
type SoloSetupPreference = {
  timeEnabled: boolean;
  repsEnabled: boolean;
  seconds: number;
  reps: number;
};

export type ExerciseId = 'pushup';

export type FormGrade = 'Perfect' | 'Good' | 'Okay' | 'Poor';

export interface ExerciseRep {
  index: number;
  timestamp: number;
  durationMs: number;
  minimumElbowAngle: number;
  maximumElbowAngle: number;
  averageBodyAngle: number;
  qualityScore: number;
  grade: FormGrade;
}

export interface WorkoutSession {
  /** Ownership and measurement availability for confirmed online workouts. */
  accountId?: string;
  qualityAvailable?: boolean;
  id: string;
  exercise: ExerciseId;
  mode?: WorkoutModeId;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  totalReps: number;
  validReps: number;
  averageQuality: number;
  perfectReps: number;
  xpEarned: number;
  bestRepQuality: number;
  averageRepDuration: number;
  reps: ExerciseRep[];
}

export interface BattleRecord {
  id: string;
  mode: 'bot' | 'private' | 'casual' | 'ranked';
  opponentName: string;
  userScore: number;
  opponentScore: number;
  outcome: 'win' | 'loss' | 'draw';
  durationSeconds: number;
  completedAt: string;
  ratingBefore?: number;
  ratingAfter?: number;
}

export interface UserProfile {
  id: string;
  displayName: string;
  lifetimeXP: number;
  lifetimePushups: number;
  perfectReps: number;
  currentStreak: number;
  longestStreak: number;
  totalWorkouts: number;
  battleWins: number;
  battleLosses: number;
  battleDraws: number;
  rankedBattleCompletions: number;
  highestServerRankedRating: number;
  recordedBattleIds: string[];
  lastWorkoutDate: string | null;
  dailyProgressDate: string;
  dailyPushups: number;
  createdAt: string;
}

export interface AppSettings {
  /** Device-local, versioned feature explanations the player explicitly dismissed. */
  dismissedFeatureTips?: string[];
  /** Optional device-local weekly intention; no rewards or streak changes. */
  weeklyCommitmentDays?: number | null;
  /** Explicit device-local setup; absent in older saved settings. */
  favoriteWorkoutSetup?: FavoriteWorkoutSetup | null;
  /** Cosmetic, device-local favorites. Older saved settings may omit this field. */
  pinnedAchievementIds?: string[];
  voiceRepCount: boolean;
  soundEffectsEnabled: boolean;
  soundEffectsVolume: number;
  battleMusicEnabled?: boolean;
  creatureSoundsEnabled?: boolean;
  matchEntrancesEnabled: boolean;
  haptics: boolean;
  skeletonOverlay: boolean;
  formFeedback: boolean;
  dailyGoal: number;
  debugMode: boolean;
  reducedMotion: boolean;
  preferredCamera: 'front' | 'back';
  multiplayerAgeConfirmed: boolean;
  multiplayerRulesAccepted: boolean;
  autoStartWorkouts: boolean;
  /** Hands-free local expedition preferences; legacy settings default to on. */
  encounterAutoStart?: boolean;
  encounterAutoNext?: boolean;
  /** Device-local UI choices; never unlock encounters or change account progression. */
  trialsDifficulty?: BossDifficulty;
  trialsIsland?: WorldId | null;
  lastSoloSetup?: SoloSetupPreference;
  startDelaySeconds: StartDelaySeconds;
}

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  category?: 'training' | 'form' | 'consistency' | 'battle' | 'level';
}

export interface UnlockedAchievement {
  id: string;
  unlockedAt: string;
}

export interface AppSnapshot {
  profile: UserProfile;
  settings: AppSettings;
  workouts: WorkoutSession[];
  battleHistory: BattleRecord[];
  unlockedAchievements: UnlockedAchievement[];
  onboardingComplete: boolean;
}
