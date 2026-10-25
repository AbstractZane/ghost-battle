import { poseAt } from '@/tests/poseFixtures';

/** Synthetic vertically projected body, NOT reconstructed phone landmarks.
 * In-plane transforms exercise projection gates, not camera accuracy. */
export function projectedPlankAt(
  angle: number,
  timestamp: number,
  standing = false,
  ankleConfidence = 0.95,
  kneeAngle = 180,
) {
  const pose = poseAt(angle, timestamp, { kneeAngle });
  for (const side of ['left', 'right'] as const) {
    const shoulder = pose.landmarks[`${side}Shoulder`]!;
    for (const joint of ['Elbow', 'Wrist'] as const) {
      const landmark = pose.landmarks[`${side}${joint}`]!;
      landmark.x = shoulder.x + (landmark.x - shoulder.x) * 0.5;
      landmark.y = shoulder.y + (landmark.y - shoulder.y) * 0.5;
    }
    pose.landmarks[`${side}Ankle`]!.confidence = ankleConfidence;
  }
  const radians = ((standing ? 70 : -70) * Math.PI) / 180;
  for (const landmark of Object.values(pose.landmarks)) {
    if (!landmark) continue;
    const x = landmark.x - 0.5;
    const y = landmark.y - 0.5;
    landmark.x = 0.5 + x * Math.cos(radians) - y * Math.sin(radians);
    landmark.y = 0.5 + x * Math.sin(radians) + y * Math.cos(radians);
  }
  return { ...pose, cameraFacing: 'front' as const };
}
