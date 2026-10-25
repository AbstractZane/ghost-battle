import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const estimatePoses = vi.fn();
  const reset = vi.fn();
  const dispose = vi.fn();
  return {
    createDetector: vi.fn(() => Promise.resolve({ estimatePoses, reset, dispose })),
    estimatePoses,
    reset,
    dispose,
    ready: vi.fn(() => Promise.resolve(undefined)),
    setBackend: vi.fn(() => Promise.resolve(true)),
  };
});

vi.mock('@tensorflow/tfjs-backend-webgl', () => ({}));
vi.mock('@tensorflow/tfjs-core', () => ({
  ready: mocks.ready,
  setBackend: mocks.setBackend,
}));
vi.mock('@tensorflow-models/pose-detection', () => ({
  SupportedModels: { MoveNet: 'MoveNet' },
  createDetector: mocks.createDetector,
  movenet: { modelType: { SINGLEPOSE_LIGHTNING: 'SINGLEPOSE_LIGHTNING' } },
}));

import { WebMoveNetPoseEstimator } from './WebMoveNetPoseEstimator.web';

describe('WebMoveNetPoseEstimator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.estimatePoses.mockResolvedValue([
      {
        keypoints: [
          { name: 'left_shoulder', x: 120, y: 80, score: 0.9 },
          { name: 'left_elbow', x: 140, y: 120, score: 0.9 },
          { name: 'left_wrist', x: 160, y: 160, score: 0.9 },
        ],
      },
    ]);
  });

  it('keeps MoveNet temporal crop state between consecutive camera frames', async () => {
    const estimator = await WebMoveNetPoseEstimator.create();
    const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

    await estimator.estimate(video, 'front', 1_000);
    await estimator.estimate(video, 'front', 1_050);

    expect(mocks.estimatePoses).toHaveBeenCalledTimes(2);
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it('resets temporal crop state only when the camera source changes', async () => {
    const estimator = await WebMoveNetPoseEstimator.create();

    estimator.resetForCameraSourceChange();

    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });
});
