import type { PoseQualityResult } from '@/pose/poseQuality';
import type { PoseSide, PoseLandmarkName } from '@/pose/poseTypes';
import type { PushupStateMachineDiagnosticsV5 } from './PushupStateMachineV5';

export type PushupReadinessReasonV5 =
  | 'NO_PERSON'
  | 'MOVE_FARTHER_BACK'
  | 'MOVE_CLOSER'
  | 'FULL_BODY_NOT_VISIBLE'
  | 'ARM_NOT_VISIBLE'
  | 'HIP_NOT_VISIBLE'
  | 'POSE_UNSTABLE'
  | 'GET_INTO_PUSHUP_POSITION'
  | 'HOLD_STILL';

export const READINESS_REASON_LABELS_V5: Readonly<Record<PushupReadinessReasonV5, string>> = {
  NO_PERSON: 'NO PERSON',
  MOVE_FARTHER_BACK: 'MOVE FARTHER BACK',
  MOVE_CLOSER: 'MOVE CLOSER',
  FULL_BODY_NOT_VISIBLE: 'FULL BODY NOT VISIBLE',
  ARM_NOT_VISIBLE: 'ARM NOT VISIBLE',
  HIP_NOT_VISIBLE: 'HIP NOT VISIBLE',
  POSE_UNSTABLE: 'POSE UNSTABLE',
  GET_INTO_PUSHUP_POSITION: 'GET INTO PUSHUP POSITION',
  HOLD_STILL: 'HOLD STILL',
};

export type PushupPhaseV5 =
  'NOT_READY' | 'TOP' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING' | 'TOP_CONFIRMED';

export interface SideQualityV5 {
  side: PoseSide;
  score: number;
  confidenceScore: number;
  stability: number;
  landmarks: Record<'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle', number>;
}

export interface SideSelectionV5 {
  side: PoseSide;
  left: SideQualityV5;
  right: SideQualityV5;
  changed: boolean;
  reason: string;
  alternativeBetterMs: number;
}

export interface PushupReadinessV5Result extends PoseQualityResult {
  version: 'V5';
  reason: PushupReadinessReasonV5 | null;
  poseQuality: number;
  stability: number;
  sideScoreLeft: number;
  sideScoreRight: number;
  sideChanged: boolean;
  sideSelectionReason: string;
  sideSelectionAlternativeBetterMs: number;
  freshCriticalLandmarks: PoseLandmarkName[];
}

export interface PushupDiagnosticsV5 {
  version: 'V5';
  readiness: PushupReadinessV5Result;
  activeSide: PoseSide;
  poseQuality: number;
  stability: number;
  sideScoreLeft: number;
  sideScoreRight: number;
  phase: PushupPhaseV5;
  elbowAngle?: number;
  elbowVelocity?: number;
  bodyLineMetric?: number;
  rejectionReason?: string;
  candidateActive: boolean;
  temporal: PushupStateMachineDiagnosticsV5;
}
