import type { AppSettings, UserProfile } from '@/types/models';
import { DEFAULT_CAMERA_FACING } from '@/pose/cameraSelection';

export const DEFAULT_SETTINGS: AppSettings = {
  dismissedFeatureTips: [],
  weeklyCommitmentDays: null,
  favoriteWorkoutSetup: null,
  pinnedAchievementIds: [],
  voiceRepCount: false,
  soundEffectsEnabled: true,
  soundEffectsVolume: 0.35,
  battleMusicEnabled: true,
  creatureSoundsEnabled: true,
  matchEntrancesEnabled: true,
  haptics: true,
  skeletonOverlay: true,
  formFeedback: true,
  dailyGoal: 25,
  debugMode: false,
  reducedMotion: false,
  preferredCamera: DEFAULT_CAMERA_FACING,
  multiplayerAgeConfirmed: false,
  multiplayerRulesAccepted: false,
  autoStartWorkouts: true,
  encounterAutoStart: true,
  encounterAutoNext: true,
  trialsDifficulty: 'gentle',
  trialsIsland: null,
  lastSoloSetup: { timeEnabled: false, repsEnabled: false, seconds: 60, reps: 25 },
  startDelaySeconds: 3,
};

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDefaultProfile(now = new Date()): UserProfile {
  return {
    id: 'local-player',
    displayName: 'Athlete',
    lifetimeXP: 0,
    lifetimePushups: 0,
    perfectReps: 0,
    currentStreak: 0,
    longestStreak: 0,
    totalWorkouts: 0,
    battleWins: 0,
    battleLosses: 0,
    battleDraws: 0,
    rankedBattleCompletions: 0,
    highestServerRankedRating: 0,
    recordedBattleIds: [],
    lastWorkoutDate: null,
    dailyProgressDate: localDateKey(now),
    dailyPushups: 0,
    createdAt: now.toISOString(),
  };
}
