import { landmarkDistance } from '@/pose/poseMath';
import { landmarksForSide } from '@/pose/sideSelector';
import type { PoseResult, PoseSide } from '@/pose/poseTypes';
import { HYBRID_PUSHUP_RULES, type HybridPushupRules } from '../pushupRules';

/** Projected lengths are not anatomical proportions: a foreshortened torso can
 * be shorter than either arm segment. Only reject degenerate/extreme geometry. */
export function hybridPoseGeometry(
  pose: PoseResult,
  side: PoseSide,
  rules: HybridPushupRules = HYBRID_PUSHUP_RULES,
): boolean {
  const names = landmarksForSide(side);
  const points = pose.landmarks;
  const upper = landmarkDistance(points[names.shoulder], points[names.elbow]);
  const lower = landmarkDistance(points[names.elbow], points[names.wrist]);
  if (
    [upper, lower].some(
      (length) =>
        length === null ||
        !Number.isFinite(length) ||
        length < rules.minimumProjectedSegment ||
        length > rules.maximumProjectedSegment,
    )
  )
    return false;
  const reliable = (name: keyof typeof points) =>
    (points[name]?.confidence ?? 0) >= rules.armLandmarkConfidence;
  const torso = reliable(names.hip)
    ? landmarkDistance(points[names.shoulder], points[names.hip])
    : null;
  const widths = [
    ['leftShoulder', 'rightShoulder'],
    ['leftHip', 'rightHip'],
  ] as const;
  const spans = widths.flatMap(([left, right]) => {
    const length =
      reliable(left) && reliable(right) ? landmarkDistance(points[left], points[right]) : null;
    return length === null ? [] : [length];
  });
  const bodyScale = Math.max(torso ?? 0, ...spans);
  const segmentScale = Math.max(torso ?? 0, upper ?? 0, lower ?? 0);
  return (
    (bodyScale < rules.minimumProjectedSegment ||
      Math.max(upper ?? 0, lower ?? 0) / bodyScale <= rules.maximumProjectedProportion) &&
    spans.every(
      (span) =>
        span <= rules.maximumProjectedSegment &&
        span / segmentScale <= rules.maximumProjectedProportion,
    )
  );
}
