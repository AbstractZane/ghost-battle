import type { PoseResult, PoseSide } from '@/pose/poseTypes';
import { landmarksForSide } from '@/pose/sideSelector';
import type { PushupRules } from './pushupRules';

/** A bounded 2D floor-support hypothesis, not inferred depth or knee contact.
 * Signed vertical relationships distinguish this projection from upright arms.
 * No side-view horizontal-angle limit is relaxed outside the opted-in lab. */
export function hasFrontViewPlankSupport(
  pose: PoseResult,
  side: PoseSide,
  rules: Readonly<PushupRules>,
): boolean {
  if (rules.labAllowFrontViewPlank !== 1 || pose.tracking?.signalQuality === 'LOST') return false;
  const names = landmarksForSide(side);
  for (const name of [names.shoulder, names.hip, names.wrist]) {
    const point = pose.landmarks[name];
    if (
      !point ||
      ![point.x, point.y, point.confidence].every(Number.isFinite) ||
      Math.min(point.confidence, pose.rawLandmarks?.[name]?.confidence ?? point.confidence) <
        rules.minimumCoreLandmarkConfidence ||
      (pose.tracking &&
        (!pose.tracking.freshLandmarks.includes(name) ||
          pose.tracking.predictedLandmarks?.includes(name) ||
          pose.tracking.rejectedLandmarks?.includes(name)))
    )
      return false;
  }
  const shoulder = pose.landmarks[names.shoulder]!;
  const hip = pose.landmarks[names.hip]!;
  const wrist = pose.landmarks[names.wrist]!;
  const length = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);
  return (
    length >= rules.minimumTorsoLength &&
    length <= rules.maximumTorsoLength &&
    shoulder.y - hip.y >= length * rules.frontViewHipAboveShoulderRatio &&
    wrist.y - hip.y >= length * rules.frontViewWristBelowHipRatio
  );
}
