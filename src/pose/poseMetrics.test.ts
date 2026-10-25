import { describe, expect, it } from 'vitest';

import { poseAt } from '@/tests/poseFixtures';

import { noisiestLandmark, summarizePoseMotion } from './poseMetrics';

describe('pose metrics', () => {
  it('reports mean and p95 joint displacement from timestamp-ordered poses', () => {
    const poses = [poseAt(165, 0), poseAt(165, 67), poseAt(165, 134)];
    poses[1]!.landmarks.leftWrist!.x += 0.01;
    poses[2]!.landmarks.leftWrist!.x += 0.02;
    const summary = summarizePoseMotion(poses);
    expect(summary.samples).toBeGreaterThan(0);
    expect(summary.meanJointDisplacement).toBeGreaterThan(0);
    expect(summary.p95JointDisplacement).toBeGreaterThanOrEqual(summary.meanJointDisplacement);
    expect(summary.byLandmark.leftWrist?.meanJointDisplacement).toBeGreaterThan(0);
    expect(noisiestLandmark(summary)?.name).toBe('leftWrist');
  });
});
