import { describe, expect, it } from 'vitest';

import {
  DROP_INFERENCE_FRAMES_WHILE_BUSY,
  DEVELOPMENT_LIGHTNING_TARGET_FPS,
  POSE_INFERENCE_INTERVAL_MS,
  poseInferenceIntervalMs,
  poseInferenceTargetFps,
  shouldSchedulePoseInference,
  TARGET_POSE_INFERENCE_FPS,
} from './poseInferenceSchedule';

describe('pose inference scheduling', () => {
  it('targets current 15 FPS poses and drops frames instead of building a busy queue', () => {
    expect(TARGET_POSE_INFERENCE_FPS).toBe(15);
    expect(DROP_INFERENCE_FRAMES_WHILE_BUSY).toBe(true);
    expect(shouldSchedulePoseInference(1000, 1000 + POSE_INFERENCE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldSchedulePoseInference(1000, 1000 + POSE_INFERENCE_INTERVAL_MS)).toBe(true);
  });

  it('keeps both production model cadences at the conservative default', () => {
    expect(poseInferenceTargetFps('movenet-thunder')).toBe(15);
    expect(poseInferenceTargetFps('movenet-lightning')).toBe(15);
  });

  it('allows a higher Lightning cadence only when explicitly development-enabled', () => {
    expect(
      poseInferenceTargetFps('movenet-lightning', {
        experimentalLightning: true,
        development: false,
      }),
    ).toBe(15);
    expect(
      poseInferenceTargetFps('movenet-lightning', {
        experimentalLightning: true,
        development: true,
      }),
    ).toBe(DEVELOPMENT_LIGHTNING_TARGET_FPS);
    expect(poseInferenceIntervalMs(30)).toBeCloseTo(33.33, 1);
    expect(() => poseInferenceIntervalMs(0)).toThrow();
  });
});
