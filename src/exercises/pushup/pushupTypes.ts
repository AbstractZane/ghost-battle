import type { PoseSide } from '@/pose/poseTypes';
import type { PushupContextState } from './PushupContextDetector';
import type { PushupExerciseVariant } from './PushupVariantClassifier';
import type { SideLandmarkConfidences } from '@/pose/sideSelector';
import type { ExerciseRep } from '@/types/models';

export type PushupState = 'NOT_READY' | 'UP' | 'DESCENDING' | 'DOWN' | 'ASCENDING';
export type PushupArmState = 'DISARMED' | 'ARMING' | 'ARMED';
export type PushupElbowSource = 'left' | 'right' | 'fused';
export type PushupCandidateEligibility =
  'INACTIVE' | 'PENDING_STANDARD' | 'STANDARD' | 'MODIFIED_KNEE';

export type RejectedRepReason =
  | 'INSUFFICIENT_DEPTH'
  | 'INCOMPLETE_EXTENSION'
  | 'BODY_ALIGNMENT'
  | 'MODIFIED_PUSHUP'
  | 'TRACKING_LOST'
  | 'MOVEMENT_TOO_FAST'
  | 'INVALID_SEQUENCE'
  | 'VARIANT_UNCONFIRMED'
  | 'POSE_UNSTABLE'
  | 'SIDE_SWITCH_ARTIFACT'
  | 'IMPOSSIBLE_MOTION';

export interface PushupMetrics {
  elbowAngle?: number;
  leftElbowAngle?: number;
  rightElbowAngle?: number;
  elbowSource?: PushupElbowSource;
  armSignalReliable: boolean;
  bodyAngle?: number;
  kneeAngle?: number;
  legChainAngle?: number;
  ankleExtensionRatio?: number;
  ankleDeviationRatio?: number;
  variantConfidence?: number;
  exerciseVariant: PushupExerciseVariant;
  variantFrameEvidence: PushupExerciseVariant;
  variantSide?: PoseSide;
  confidence?: number;
  selectedSide: PoseSide;
  leftVisibility: number;
  rightVisibility: number;
  leftCoreConfidence: number;
  rightCoreConfidence: number;
  leftLandmarks: SideLandmarkConfidences;
  rightLandmarks: SideLandmarkConfidences;
  coreConfidence: number;
  supportingConfidence: number;
  sideSelectionReason: string;
  sideSelectionAlternativeBetterMs: number;
  bodyAlignmentSource: 'ankle' | 'knee' | 'unavailable';
  torsoAngleFromHorizontal?: number;
  wristHeightToHipRatio?: number;
  postureEvidence?: 'UPRIGHT' | 'KNEES_DOWN' | 'UNKNOWN';
  postureEvidenceMs?: number;
  bodySpan?: number;
  frontViewPlankSupport?: boolean;
  motionBodyEligible?: boolean;
  armState: PushupArmState;
  contextState: PushupContextState;
  signalQuality: 'GOOD' | 'DEGRADED' | 'LOST';
  elbowVelocity?: number;
  motionPhase: PushupState;
  recentPeakAngle?: number;
  recentPeakTimestamp?: number;
  candidateActive: boolean;
  candidateEligibility: PushupCandidateEligibility;
  requestedTransition?: PushupState;
  transitionAccepted: boolean;
  lastRejectionReason?: RejectedRepReason;
}

export interface ExerciseDetectionResult {
  state: PushupState;
  repCompleted: boolean;
  totalReps: number;
  qualityScore?: number;
  feedback: string;
  metrics: PushupMetrics;
  rep?: ExerciseRep;
  rejectedReason?: RejectedRepReason;
}

export interface PushupDebugEvent {
  timestamp: number;
  elbowAngle?: number;
  bodyAngle?: number;
  confidence?: number;
  selectedSide?: PoseSide;
  elbowSource?: PushupElbowSource;
  currentState: PushupState;
  nextState?: PushupState;
  reasonForTransition?: string;
  repAccepted: boolean;
  repRejected: boolean;
  rejectionReason?: RejectedRepReason;
  candidateEligibility?: PushupCandidateEligibility;
  recentPeakAngle?: number;
  recentPeakTimestamp?: number;
}
