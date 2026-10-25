import { describe, expect, it } from 'vitest';

import { PoseEngineV3 } from '@/pose/poseEngineV3';
import { poseAt } from '@/tests/poseFixtures';

import { PushupDetectorV6 } from './PushupDetectorV6';

describe('PushupDetectorV6 through Pose Engine V3', () => {
  it('does not inherit the legacy hip-based aggregate tracking gate', () => {
    const detector = new PushupDetectorV6();
    const engine = new PoseEngineV3();
    const frames = [
      [165, 0],
      [165, 180],
      [148, 280],
      [132, 380],
      [102, 500],
      [92, 600],
      [120, 720],
      [148, 850],
      [165, 960],
    ].map(([angle, timestamp]) => {
      const pose = poseAt(angle ?? 165, timestamp ?? 0);
      return {
        ...pose,
        landmarks: {
          ...pose.landmarks,
          leftHip: { ...pose.landmarks.leftHip!, confidence: 0.02 },
          leftKnee: { ...pose.landmarks.leftKnee!, confidence: 0.02 },
          leftAnkle: { ...pose.landmarks.leftAnkle!, confidence: 0.02 },
          rightHip: { ...pose.landmarks.rightHip!, confidence: 0.02 },
          rightKnee: { ...pose.landmarks.rightKnee!, confidence: 0.02 },
          rightAnkle: { ...pose.landmarks.rightAnkle!, confidence: 0.02 },
        },
      };
    });

    const results = frames.flatMap((frame) => {
      const pipeline = engine.update(frame);
      return pipeline ? [detector.processPose(pipeline.rawPose)] : [];
    });

    expect(results.every((result) => result.metrics.armSignalReliable)).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(1);
  });
});
