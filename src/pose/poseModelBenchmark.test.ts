import { describe, expect, it } from 'vitest';

import { poseAt } from '@/tests/poseFixtures';

import { PoseModelBenchmark } from './poseModelBenchmark';

describe('pose model benchmark aggregation', () => {
  it('reports measured latency, FPS, pose age, jitter, and confidence without invented values', () => {
    const benchmark = new PoseModelBenchmark('movenet-thunder', 'front', 0, 200);
    const poses = [poseAt(165, 0), poseAt(165, 100), poseAt(165, 200)];
    for (const pose of poses) {
      pose.poseModel = 'movenet-thunder';
      pose.cameraFacing = 'front';
    }
    poses[0]!.inferenceLatencyMs = 30;
    poses[1]!.inferenceLatencyMs = 40;
    poses[2]!.inferenceLatencyMs = 50;
    poses[1]!.landmarks.leftWrist!.x += 0.01;
    poses[2]!.landmarks.leftWrist!.x += 0.02;

    expect(benchmark.add(poses[0]!, 10)).toBeNull();
    expect(benchmark.add(poses[1]!, 115)).toBeNull();
    const result = benchmark.add(poses[2]!, 220);

    expect(result).toMatchObject({
      poseModel: 'movenet-thunder',
      cameraFacing: 'front',
      framesAnalyzed: 3,
      meanInferenceMs: 40,
      meanPoseFps: 10,
      meanPoseAgeMs: 15,
    });
    expect(result?.p95InferenceMs).toBe(50);
    expect(result?.stationaryJointJitter).toBeGreaterThan(0);
    expect(result?.worstJoint?.name).toBe('leftWrist');
    expect(result?.confidence.mean).toBeGreaterThan(0);
    expect(result?.confidence.samples).toBeGreaterThan(0);
  });

  it('ignores frames from a different camera or pose model', () => {
    const benchmark = new PoseModelBenchmark('movenet-lightning', 'back', 0, 100);
    const wrongCamera = poseAt(165, 100);
    wrongCamera.poseModel = 'movenet-lightning';
    wrongCamera.cameraFacing = 'front';
    const wrongModel = poseAt(165, 100);
    wrongModel.poseModel = 'movenet-thunder';
    wrongModel.cameraFacing = 'back';
    expect(benchmark.add(wrongCamera, 100)).toBeNull();
    expect(benchmark.add(wrongModel, 100)).toBeNull();
    expect(benchmark.result()).toMatchObject({
      poseModel: 'movenet-lightning',
      cameraFacing: 'back',
      framesAnalyzed: 0,
    });
  });
});
