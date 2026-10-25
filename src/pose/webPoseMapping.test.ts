import { describe, expect, it } from 'vitest';

import { BLAZEPOSE_FULL } from './poseModels';
import { mapWebBlazePose } from './webPoseMapping';

describe('mapWebBlazePose', () => {
  it('keeps BlazePose-specific landmarks behind the canonical 17-landmark boundary', () => {
    const pose = mapWebBlazePose({
      videoWidth: 640,
      videoHeight: 480,
      timestamp: 100,
      inferenceLatencyMs: 12,
      cameraFacing: 'front',
      keypoints: [
        { name: 'left_shoulder', x: 100, y: 150, score: 0.92 },
        { name: 'left_elbow', x: 160, y: 180, score: 0.87 },
        { name: 'left_wrist', x: 220, y: 200, score: 0.83 },
        { name: 'left_pinky', x: 230, y: 200, score: 0.9 },
      ],
      keypoints3D: [{ name: 'left_elbow', x: 0, y: 0, z: -0.16, score: 0.9 }],
    });

    expect(pose?.poseModel).toBe(BLAZEPOSE_FULL);
    expect(pose?.landmarks.leftElbow).toMatchObject({ x: 0.25, y: 0.28125, z: -0.16 });
    expect(pose?.landmarks).not.toHaveProperty('leftPinky');
  });
});
