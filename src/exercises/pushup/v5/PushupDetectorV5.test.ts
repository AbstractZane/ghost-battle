import { describe, expect, it } from 'vitest';

import { PoseEngineV3 } from '@/pose/poseEngineV3';
import { calculateAngle } from '@/pose/poseMath';
import { poseAt } from '@/tests/poseFixtures';

import { PushupDetectorV5 } from './PushupDetectorV5';
import { replayFramesV5 } from './replayBenchmarkV5';
import { pushupReplayFixturesV5, validPushupsV5 } from './v5Fixtures';

describe('PushupDetectorV5', () => {
  it('counts five coherent pushups exactly once each', () => {
    const results = replayFramesV5(validPushupsV5(5), new PushupDetectorV5());
    expect(results.filter((result) => result.repCompleted)).toHaveLength(5);
    expect(results.at(-1)?.totalReps).toBe(5);
  });

  it.each([
    'half rep',
    '140-145 partial depth',
    'elbow flex while standing',
    'kneeling repositioning',
    'camera shake during motion',
    'starts halfway down',
    'never returns to top',
    'bottom threshold jitter',
    'top threshold jitter',
    'impossible 150ms rep',
    'one-frame bottom spike',
    'rapid 240ms spike',
    'cross-side motion artifact',
    'random MoveNet noise',
  ])('rejects %s', (name) => {
    const fixture = pushupReplayFixturesV5().find((candidate) => candidate.name === name);
    expect(fixture).toBeDefined();
    const results = replayFramesV5(fixture?.frames ?? [], new PushupDetectorV5());
    expect(results.at(-1)?.totalReps ?? 0).toBe(0);
  });

  it.each([
    'confidence noise',
    'temporary wrist dropout',
    'temporary ankle dropout',
    'brief keypoint jitter',
    'normal torso motion during rep',
    'temporary active-side loss',
  ])('preserves the valid rep through %s', (name) => {
    const fixture = pushupReplayFixturesV5().find((candidate) => candidate.name === name);
    expect(fixture).toBeDefined();
    const results = replayFramesV5(fixture?.frames ?? [], new PushupDetectorV5());
    if (results.at(-1)?.totalReps !== 1) {
      console.info(
        name,
        results.map((result) => ({
          state: result.state,
          angle: result.metrics.elbowAngle,
          velocity: result.metrics.elbowVelocity,
          ready: result.metrics.contextState,
          rejection: result.rejectedReason,
        })),
      );
    }
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('is deterministic across repeated replays', () => {
    const frames = validPushupsV5(1);
    const first = replayFramesV5(frames, new PushupDetectorV5()).map((result) => ({
      state: result.state,
      reps: result.totalReps,
      rejection: result.rejectedReason,
    }));
    const second = replayFramesV5(frames, new PushupDetectorV5()).map((result) => ({
      state: result.state,
      reps: result.totalReps,
      rejection: result.rejectedReason,
    }));
    expect(second).toEqual(first);
  });

  it('keeps an active valid candidate when setup stability drops during expected motion', () => {
    const fixture = pushupReplayFixturesV5().find(
      (candidate) => candidate.name === 'normal torso motion during rep',
    );
    const detector = new PushupDetectorV5();
    const engine = new PoseEngineV3();
    const diagnostics = [];
    const results = [];
    for (const pose of fixture?.frames ?? []) {
      const pipeline = engine.update(pose);
      if (!pipeline) continue;
      results.push(detector.processPose(pipeline.detectorPose, pipeline.detectorPose.timestamp));
      const current = detector.getDiagnostics();
      if (current) diagnostics.push(current);
    }

    expect(diagnostics.some((current) => current.candidateActive)).toBe(true);
    expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
    expect(results.some((result) => result.rejectedReason === 'POSE_UNSTABLE')).toBe(false);
  });

  it('does not permanently latch a transient modified-knee observation', () => {
    const frames = validPushupsV5(1, 80).map((pose, index) => {
      if (index < 5 || index > 8) return pose;
      const elbowAngle =
        calculateAngle(
          pose.landmarks.leftShoulder,
          pose.landmarks.leftElbow,
          pose.landmarks.leftWrist,
        ) ?? 166;
      return poseAt(elbowAngle, pose.timestamp, { kneeAngle: 90 });
    });
    const detector = new PushupDetectorV5();
    const results = frames.map((pose) => detector.processPose(pose, pose.timestamp));

    expect(results.some((result) => result.metrics.exerciseVariant === 'MODIFIED_KNEE')).toBe(true);
    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(false);
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('counts a valid rep when ankle visibility is ambiguous but no sustained knee evidence exists', () => {
    const frames = validPushupsV5(1).map((pose) => {
      const leftAnkle = pose.landmarks.leftAnkle;
      const rightAnkle = pose.landmarks.rightAnkle;
      return {
        ...pose,
        landmarks: {
          ...pose.landmarks,
          leftAnkle: leftAnkle ? { ...leftAnkle, confidence: 0.1 } : leftAnkle,
          rightAnkle: rightAnkle ? { ...rightAnkle, confidence: 0.1 } : rightAnkle,
        },
      };
    });
    const results = replayFramesV5(frames, new PushupDetectorV5());

    expect(results.some((result) => result.rejectedReason === 'VARIANT_UNCONFIRMED')).toBe(false);
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('still rejects sustained modified-knee evidence', () => {
    const frames = validPushupsV5(1, 80).map((pose, index) => {
      if (index < 10) return pose;
      const elbowAngle =
        calculateAngle(
          pose.landmarks.leftShoulder,
          pose.landmarks.leftElbow,
          pose.landmarks.leftWrist,
        ) ?? 166;
      return poseAt(elbowAngle, pose.timestamp, { kneeAngle: 90 });
    });
    const results = replayFramesV5(frames, new PushupDetectorV5());

    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
  });
});
