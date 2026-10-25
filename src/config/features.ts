export const DETECTOR_LAB_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_ENABLE_DETECTOR_LAB === 'true';

// Explicit preview/rollout flag. Default off until UI acceptance and staffed moderation.
export const SOCIAL_MESSAGES_ENABLED = process.env.EXPO_PUBLIC_ENABLE_SOCIAL_MESSAGES === 'true';

// Reveal the website Shop only after migration 035 and Stripe pack setup are ready.
export const SHOP_ENABLED = process.env.EXPO_PUBLIC_ENABLE_SHOP === 'true';

// Private Android filming build; does not replace the public app or online modes.
export const CREATOR_STUDIO_ENABLED = process.env.EXPO_PUBLIC_CREATOR_STUDIO === 'true';

export const FEATURES = {
  privateBattles: true,
  botBattles: true,
  casualMatchmaking: true,
  rankedLadder: true,
  remoteVideo: false,
  squatSolo: false,
  competitiveSquats: false,
  leaderboards: true,
  rankedSeasons: false,
  pushNotifications: false,
  browserPoseWorkouts: true,
  browserLiveBattles: true,
} as const;

export const FEATURE_BLOCKERS = {
  casualMatchmaking: 'Requires migration 202608200004 and a passing hostile-client staging suite.',
  rankedLadder: 'Requires migration 202608200004 and a passing hostile-client staging suite.',
  remoteVideo:
    'Requires a supported single-camera native bridge from VisionCamera to a WebRTC video source and TURN deployment.',
  squatSolo:
    'Detector implemented; requires representative physical-device validation before release.',
  competitiveSquats:
    'Requires validated Squat Solo traces and a server-approved squat rep contract.',
  leaderboards:
    'Requires migration 020; device acceptance and hosted rollout remain separate from local checks.',
  rankedSeasons: 'Requires a server-owned season lifecycle and staging rollover tests.',
  pushNotifications: 'Requires APNs/FCM/Expo credentials and physical-device delivery testing.',
  browserPoseWorkouts:
    'Implemented with local TFJS MoveNet Lightning; representative iPhone and Android browser testing remains required.',
  browserLiveBattles:
    'Implemented with shared browser camera capture and direct WebRTC; requires Supabase signaling/TURN deployment and two-device validation.',
} as const;
