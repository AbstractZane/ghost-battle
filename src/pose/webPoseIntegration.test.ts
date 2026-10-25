import { describe, expect, it } from 'vitest';

import { PushupDetector } from '@/exercises/pushup/PushupDetector';
import { poseAt, validRepSequence } from '@/tests/poseFixtures';
import { PoseEngineV3 } from './poseEngineV3';
import type { PoseLandmarkName, PoseResult } from './poseTypes';
import { mapWebMoveNetPose, type WebMoveNetKeypoint } from './webPoseMapping';

const snakeNames: Record<PoseLandmarkName, string> = {
  nose: 'nose',
  leftEye: 'left_eye',
  rightEye: 'right_eye',
  leftEar: 'left_ear',
  rightEar: 'right_ear',
  leftShoulder: 'left_shoulder',
  rightShoulder: 'right_shoulder',
  leftElbow: 'left_elbow',
  rightElbow: 'right_elbow',
  leftWrist: 'left_wrist',
  rightWrist: 'right_wrist',
  leftHip: 'left_hip',
  rightHip: 'right_hip',
  leftKnee: 'left_knee',
  rightKnee: 'right_knee',
  leftAnkle: 'left_ankle',
  rightAnkle: 'right_ankle',
};

function throughWebMapping(pose: PoseResult): PoseResult {
  const keypoints = (
    Object.entries(pose.landmarks) as Array<
      [PoseLandmarkName, NonNullable<PoseResult['landmarks'][PoseLandmarkName]>]
    >
  ).map<WebMoveNetKeypoint>(([name, point]) => ({
    name: snakeNames[name],
    x: point.x * 640,
    y: point.y * 640,
    score: point.confidence,
  }));
  const mapped = mapWebMoveNetPose({
    keypoints,
    videoWidth: 640,
    videoHeight: 640,
    timestamp: pose.timestamp,
    inferenceLatencyMs: 20,
    cameraFacing: 'front',
  });
  if (!mapped) throw new Error('Fixture could not be mapped');
  return mapped;
}

function runWebPipeline(poses: PoseResult[]) {
  const engine = new PoseEngineV3();
  const detector = new PushupDetector();
  return poses.flatMap((pose) => {
    const frame = engine.update(throughWebMapping(pose));
    return frame ? [detector.processPose(frame.detectorPose)] : [];
  });
}

describe('browser pose to Detector V4 integration', () => {
  it('counts a standard slow rep through Pose Engine V3 exactly once', () => {
    const results = runWebPipeline(validRepSequence());
    expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('counts a fast valid standard rep', () => {
    const sequence = [
      [165, 0],
      [165, 500],
      [140, 580],
      [82, 680],
      [115, 780],
      [165, 950],
      [165, 1050],
    ].map(([angle, time]) => poseAt(angle ?? 165, time ?? 0));
    expect(runWebPipeline(sequence).at(-1)?.totalReps).toBe(1);
  });

  it('rejects a partial and a modified knee pushup', () => {
    const partial = [
      [165, 0],
      [165, 500],
      [140, 650],
      [120, 800],
      [165, 1100],
    ].map(([angle, time]) => poseAt(angle ?? 165, time ?? 0));
    expect(runWebPipeline(partial).at(-1)?.totalReps).toBe(0);
    expect(runWebPipeline(validRepSequence(0, { kneeAngle: 110 })).at(-1)?.totalReps).toBe(0);
  });

  it('does not duplicate a rep on repeated top frames', () => {
    const sequence = [
      ...validRepSequence(),
      poseAt(165, 1500),
      poseAt(165, 1700),
      poseAt(165, 1900),
    ];
    const results = runWebPipeline(sequence);
    expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
  });

  it('counts a realistic low-FPS rep with irregular browser frame timing', () => {
    const sequence = [
      [165, 0],
      [165, 260],
      [165, 520],
      [140, 660],
      [82, 800],
      [82, 920],
      [115, 1040],
      [165, 1180],
      [165, 1320],
    ].map(([angle, timestamp]) => poseAt(angle ?? 165, timestamp ?? 0));
    expect(runWebPipeline(sequence).at(-1)?.totalReps).toBe(1);
  });

  it('rejects duplicate and stale browser timestamps before V4', () => {
    const engine = new PoseEngineV3();
    expect(engine.update(throughWebMapping(poseAt(165, 500)))).not.toBeNull();
    expect(engine.update(throughWebMapping(poseAt(85, 500)))).toBeNull();
    expect(engine.update(throughWebMapping(poseAt(85, 450)))).toBeNull();
  });

  it('keeps a valid web rep through one selected-side confidence dropout', () => {
    const sequence = validRepSequence();
    sequence.splice(5, 0, poseAt(85, 900, { missing: ['leftWrist'] }));
    expect(runWebPipeline(sequence).at(-1)?.totalReps).toBe(1);
  });
});
