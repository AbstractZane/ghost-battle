import { calculateAngle } from '@/pose/poseMath';
import type { PoseLandmark, PoseResult } from '@/pose/poseTypes';
import { poseAt } from '@/tests/poseFixtures';
import { describe, expect, it } from 'vitest';

import { HybridCandidateGenerator, type HybridMotionCandidate } from './HybridCandidateGenerator';
import { validateHybridCandidateSafety } from './HybridSafetyValidator';

function sequence(angles: ReadonlyArray<number>, intervalMs: number): PoseResult[] {
  return angles.map((angle, index) => poseAt(angle, index * intervalMs));
}

function validCycle(intervalMs: number): PoseResult[] {
  return sequence([166, 164, 154, 138, 112, 88, 84, 92, 116, 142, 158, 166], intervalMs);
}

function run(frames: ReadonlyArray<PoseResult>): HybridMotionCandidate[] {
  const generator = new HybridCandidateGenerator();
  return frames.flatMap((pose) => {
    const candidate = generator.update(pose, pose.timestamp);
    return candidate ? [candidate] : [];
  });
}

function transform(
  frames: ReadonlyArray<PoseResult>,
  change: (landmark: PoseLandmark, frameIndex: number) => PoseLandmark,
): PoseResult[] {
  return frames.map((pose, frameIndex) => {
    const landmarks = Object.fromEntries(
      Object.entries(pose.landmarks).map(([name, landmark]) => [
        name,
        landmark ? change(landmark, frameIndex) : landmark,
      ]),
    ) as PoseResult['landmarks'];
    return { ...pose, landmarks, rawLandmarks: landmarks };
  });
}

describe('HybridCandidateGenerator', () => {
  it('timestamps the observed deepest point, not the first bottom-threshold crossing', () => {
    const candidate = run(validCycle(100))[0];
    expect(candidate?.bottomAt).toBe(600);
  });
  it('survives a brief arm confidence dip without changing sides', () => {
    const frames = validCycle(100).map((pose, index) =>
      index === 6 ? poseAt(84, pose.timestamp, { confidence: 0.05 }) : pose,
    );
    expect(run(frames)).toHaveLength(1);
    expect(run(frames)[0]?.arm).toBe('left');
  });

  it('ignores a low-confidence displaced hip during a real rep', () => {
    const frames = validCycle(100);
    const hip = frames[6]?.landmarks.leftHip;
    if (hip) Object.assign(hip, { x: 0.99, y: 0.01, confidence: 0.01 });
    expect(run(frames)).toHaveLength(1);
  });

  it('tolerates brief knee and ankle loss while retaining safety evidence', () => {
    const frames = validCycle(100);
    for (const name of ['leftKnee', 'leftAnkle', 'rightKnee', 'rightAnkle'] as const) {
      const landmark = frames[6]?.landmarks[name];
      if (landmark) landmark.confidence = 0.01;
    }
    const candidate = run(frames)[0];
    expect(candidate).toBeDefined();
    expect(validateHybridCandidateSafety(candidate!, frames).accepted).toBe(true);
  });

  it('does not join motion across an interval with no delivered frames', () => {
    const frames = validCycle(100).map((pose, index) => ({
      ...pose,
      timestamp: pose.timestamp + (index >= 6 ? 2000 : 0),
    }));
    expect(run(frames)).toHaveLength(0);
  });

  it('expires top history when the person is lost before descent', () => {
    const frames = [
      poseAt(166, 0),
      ...Array.from({ length: 10 }, (_, index) =>
        poseAt(166, (index + 1) * 100, { confidence: 0.01 }),
      ),
      ...sequence([112, 84, 92, 116, 142, 166], 100).map((pose) => ({
        ...pose,
        timestamp: pose.timestamp + 1100,
      })),
    ];
    expect(run(frames)).toHaveLength(0);
  });

  it('ignores duplicate and out-of-order frames', () => {
    const frames = validCycle(100);
    const interleaved = frames.flatMap((pose) => [
      pose,
      pose,
      { ...pose, timestamp: pose.timestamp - 1 },
    ]);
    expect(run(interleaved)).toEqual(run(frames));
  });
  it.each([
    ['20 FPS', 50],
    ['15 FPS', 67],
    ['10 FPS', 100],
    ['5 FPS', 200],
  ])('finds one timestamp-based cycle at %s', (_label, intervalMs) => {
    const candidates = run(validCycle(intervalMs));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.durationMs).toBeGreaterThanOrEqual(450);
  });

  it('locks the arm with coherent motion instead of the generally stronger straight arm', () => {
    const frames = validCycle(100).map((pose) => {
      const leftAngle =
        calculateAngle(
          pose.landmarks.leftShoulder,
          pose.landmarks.leftElbow,
          pose.landmarks.leftWrist,
        ) ?? 166;
      return poseAt(leftAngle, pose.timestamp, {
        preferredSide: 'right',
        leftElbowAngle: leftAngle,
        rightElbowAngle: 172,
      });
    });

    expect(run(frames)[0]?.arm).toBe('left');
  });

  it.each([
    ['partial rep', [166, 160, 148, 132, 125, 130, 145, 160, 166]],
    ['down-only motion', [166, 158, 140, 112, 90, 84]],
    ['tiny elbow jitter', [166, 162, 165, 160, 164, 161, 166]],
  ])('does not emit a candidate for %s', (_label, angles) => {
    expect(run(sequence(angles, 100))).toHaveLength(0);
  });

  it('rejects standing elbow flex before emitting a candidate', () => {
    const standing = transform(validCycle(100), (landmark) => ({
      ...landmark,
      x: 0.5 - (landmark.y - 0.5),
      y: 0.5 + (landmark.x - 0.5),
    }));

    expect(run(standing)).toHaveLength(0);
  });

  it('rejects a camera-shake trajectory', () => {
    const shaken = transform(validCycle(100), (landmark, index) => ({
      ...landmark,
      x: landmark.x + (index % 2 === 0 ? 0.12 : -0.12),
    }));

    expect(run(shaken)).toHaveLength(0);
  });

  it('rejects an impossible 150ms cycle', () => {
    expect(run(sequence([166, 82, 120, 166], 50))).toHaveLength(0);
  });

  it('does not combine opposite-arm halves into a side-switch candidate', () => {
    const frames = [
      poseAt(166, 0, { leftElbowAngle: 166, rightElbowAngle: 166 }),
      poseAt(120, 100, { leftElbowAngle: 120, rightElbowAngle: 166 }),
      poseAt(84, 200, { leftElbowAngle: 84, rightElbowAngle: 166 }),
      poseAt(120, 300, {
        preferredSide: 'right',
        leftElbowAngle: 84,
        rightElbowAngle: 120,
        landmarkConfidence: { leftShoulder: 0.03, leftElbow: 0.03, leftWrist: 0.03 },
      }),
      poseAt(166, 400, {
        preferredSide: 'right',
        leftElbowAngle: 84,
        rightElbowAngle: 166,
        landmarkConfidence: { leftShoulder: 0.03, leftElbow: 0.03, leftWrist: 0.03 },
      }),
      poseAt(166, 1_000, {
        preferredSide: 'right',
        landmarkConfidence: { leftShoulder: 0.03, leftElbow: 0.03, leftWrist: 0.03 },
      }),
    ];

    expect(run(frames)).toHaveLength(0);
  });

  it('rejects low-confidence random noise', () => {
    const noise = Array.from({ length: 30 }, (_, index) =>
      poseAt(70 + ((index * 47) % 100), index * 80, { confidence: 0.1 }),
    );

    expect(run(noise)).toHaveLength(0);
  });

  it('requires aggregate modified-knee evidence while preserving a transient observation', () => {
    const standardFrames = validCycle(100);
    const candidate = run(standardFrames)[0];
    expect(candidate).toBeDefined();
    if (!candidate) return;
    const transient = standardFrames.map((pose, index) => {
      if (index !== 6) return pose;
      const elbowAngle =
        calculateAngle(
          pose.landmarks.leftShoulder,
          pose.landmarks.leftElbow,
          pose.landmarks.leftWrist,
        ) ?? 166;
      return poseAt(elbowAngle, pose.timestamp, { kneeAngle: 90 });
    });
    const sustained = standardFrames.map((pose, index) => {
      if (index < 3) return pose;
      const elbowAngle =
        calculateAngle(
          pose.landmarks.leftShoulder,
          pose.landmarks.leftElbow,
          pose.landmarks.leftWrist,
        ) ?? 166;
      return poseAt(elbowAngle, pose.timestamp, { kneeAngle: 90 });
    });

    expect(validateHybridCandidateSafety(candidate, transient).accepted).toBe(true);
    expect(validateHybridCandidateSafety(candidate, sustained).reason).toBe('MODIFIED_PUSHUP');
  });
});
