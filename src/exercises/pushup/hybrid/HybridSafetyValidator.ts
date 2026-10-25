import {
  DEFAULT_PUSHUP_RULES,
  HYBRID_PUSHUP_RULES,
  type HybridPushupRules,
  type PushupRules,
} from '@/exercises/pushup/pushupRules';
import { PushupVariantClassifier } from '@/exercises/pushup/PushupVariantClassifier';
import { calculateAngle } from '@/pose/poseMath';
import { landmarksForSide } from '@/pose/sideSelector';
import type { PoseResult } from '@/pose/poseTypes';

import type { HybridMotionCandidate } from './HybridCandidateGenerator';

export type HybridSafetyRejection =
  | 'INCOMPLETE_MOTION'
  | 'IMPOSSIBLE_DURATION'
  | 'IMPOSSIBLE_VELOCITY'
  | 'SEVERE_TRACKING_LOSS'
  | 'SEVERE_BODY_GEOMETRY'
  | 'SIDE_SWITCH_ARTIFACT'
  | 'MODIFIED_PUSHUP';

export interface HybridSafetyDecision {
  accepted: boolean;
  reason: HybridSafetyRejection | null;
  standardEvidenceMs: number;
  modifiedEvidenceMs: number;
  severeBodySamples: number;
  bodySamples: number;
}

/** Deterministic V5-derived protections without requiring V5's pre-rep readiness gate. */
export function validateHybridCandidateSafety(
  candidate: HybridMotionCandidate,
  poses: ReadonlyArray<PoseResult>,
  hybridRules: HybridPushupRules = HYBRID_PUSHUP_RULES,
  pushupRules: PushupRules = { ...DEFAULT_PUSHUP_RULES },
): HybridSafetyDecision {
  const base = {
    standardEvidenceMs: 0,
    modifiedEvidenceMs: 0,
    severeBodySamples: 0,
    bodySamples: 0,
  };
  const reject = (reason: HybridSafetyRejection, evidence = base): HybridSafetyDecision => ({
    accepted: false,
    reason,
    ...evidence,
  });
  if (
    candidate.minimumElbowAngle > hybridRules.bottomishElbowAngle ||
    candidate.maximumElbowAngle - candidate.minimumElbowAngle <
      hybridRules.minimumExcursionDegrees ||
    candidate.returnElbowAngle < hybridRules.returnTopElbowAngle
  ) {
    return reject('INCOMPLETE_MOTION');
  }
  if (
    candidate.durationMs < hybridRules.minimumDurationMs ||
    candidate.durationMs > hybridRules.maximumDurationMs
  ) {
    return reject('IMPOSSIBLE_DURATION');
  }
  if (candidate.maximumAngularVelocity > hybridRules.maximumAngularVelocity) {
    return reject('IMPOSSIBLE_VELOCITY');
  }
  if (
    candidate.reliableArmSamples / Math.max(1, candidate.totalSamples) <
    hybridRules.minimumReliableArmRatio
  ) {
    return reject('SIDE_SWITCH_ARTIFACT');
  }
  if (
    candidate.bodySamples < hybridRules.minimumBodySamples ||
    candidate.horizontalBodySamples / Math.max(1, candidate.bodySamples) <
      hybridRules.minimumHorizontalBodyRatio
  ) {
    return reject('SEVERE_BODY_GEOMETRY');
  }

  const variant = new PushupVariantClassifier();
  let standardEvidenceMs = 0;
  let modifiedEvidenceMs = 0;
  let severeBodySamples = 0;
  let bodySamples = 0;
  let usablePoseSamples = 0;
  let previousTimestamp: number | null = null;
  let previousEvidence: 'STANDARD' | 'MODIFIED_KNEE' | 'UNKNOWN' = 'UNKNOWN';
  for (const pose of poses) {
    const elapsed =
      previousTimestamp === null
        ? 0
        : Math.min(hybridRules.trackingGraceMs, Math.max(0, pose.timestamp - previousTimestamp));
    previousTimestamp = pose.timestamp;
    const snapshot = variant.update(pose, pose.timestamp, {
      landmarkConfidence: pushupRules.lowerBodyLandmarkConfidence,
      standardMinimumKneeAngle: pushupRules.standardMinimumKneeAngle,
      modifiedMaximumKneeAngle: pushupRules.modifiedMaximumKneeAngle,
      minimumLegChainAngle: pushupRules.minimumLegChainAngle,
      standardMinimumAnkleExtensionRatio: pushupRules.standardMinimumAnkleExtensionRatio,
      modifiedMinimumAnkleDeviationRatio: pushupRules.modifiedMinimumAnkleDeviationRatio,
      confirmationMs: pushupRules.lowerBodyVariantConfirmationMs,
      trackingGraceMs: pushupRules.trackingGraceMs,
    });
    if (snapshot.frameEvidence === 'STANDARD' && previousEvidence === 'STANDARD')
      standardEvidenceMs += elapsed;
    if (snapshot.frameEvidence === 'MODIFIED_KNEE' && previousEvidence === 'MODIFIED_KNEE')
      modifiedEvidenceMs += elapsed;
    previousEvidence = snapshot.frameEvidence;

    const names = landmarksForSide(candidate.arm);
    const shoulder = pose.landmarks[names.shoulder];
    const hip = pose.landmarks[names.hip];
    const knee = pose.landmarks[names.knee];
    const ankle = pose.landmarks[names.ankle];
    const endpoint =
      ankle && ankle.confidence >= hybridRules.armLandmarkConfidence
        ? ankle
        : knee && knee.confidence >= hybridRules.armLandmarkConfidence
          ? knee
          : undefined;
    if (
      !shoulder ||
      !hip ||
      !Number.isFinite(shoulder.confidence) ||
      !Number.isFinite(hip.confidence) ||
      shoulder.confidence < hybridRules.armLandmarkConfidence ||
      hip.confidence < hybridRules.armLandmarkConfidence
    )
      continue;
    usablePoseSamples += 1;
    const bodyAngle = calculateAngle(shoulder, hip, endpoint);
    if (bodyAngle !== null) {
      bodySamples += 1;
      if (bodyAngle < pushupRules.severeBodyAngle) severeBodySamples += 1;
    }
  }
  const evidence = { standardEvidenceMs, modifiedEvidenceMs, severeBodySamples, bodySamples };
  if (usablePoseSamples / Math.max(1, poses.length) < hybridRules.minimumReliableArmRatio) {
    return reject('SEVERE_TRACKING_LOSS', evidence);
  }
  if (modifiedEvidenceMs >= hybridRules.modifiedEvidenceMs) {
    return reject('MODIFIED_PUSHUP', evidence);
  }
  if (
    bodySamples < hybridRules.minimumBodySamples ||
    severeBodySamples / bodySamples > hybridRules.maximumSevereBodyRatio
  ) {
    return reject('SEVERE_BODY_GEOMETRY', evidence);
  }
  return { accepted: true, reason: null, ...evidence };
}
