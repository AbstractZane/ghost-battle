import { describe, expect, it } from 'vitest';

import { poseAt } from '@/tests/poseFixtures';

import { PoseTracker } from './smoothing';

describe('PoseTracker', () => {
  it('rejects a one-frame landmark teleport without adding motion lag afterward', () => {
    const tracker = new PoseTracker({
      stillAlpha: 0.35,
      motionAlpha: 0.8,
      glitchDistance: 0.22,
      confidenceFloor: 0.18,
      graceMs: 600,
    });
    const first = tracker.smooth(poseAt(165, 0));
    const glitch = poseAt(165, 80);
    if (glitch.landmarks.leftWrist) glitch.landmarks.leftWrist.x = 0.99;
    const trackedGlitch = tracker.smooth(glitch);
    expect(trackedGlitch.landmarks.leftWrist?.x).toBeCloseTo(first.landmarks.leftWrist?.x ?? 0);
    expect(trackedGlitch.tracking?.freshLandmarks).not.toContain('leftWrist');

    const recovered = tracker.smooth(poseAt(140, 160));
    expect(recovered.tracking?.freshLandmarks).toContain('leftWrist');
    expect(recovered.tracking?.signalQuality).toBe('GOOD');
  });

  it('marks temporary broad confidence loss degraded before becoming lost', () => {
    const tracker = new PoseTracker({
      stillAlpha: 0.35,
      motionAlpha: 0.7,
      glitchDistance: 0.22,
      confidenceFloor: 0.18,
      graceMs: 600,
    });
    tracker.smooth(poseAt(165, 0));
    expect(tracker.smooth(poseAt(165, 300, { confidence: 0.05 })).tracking?.signalQuality).toBe(
      'DEGRADED',
    );
    expect(tracker.smooth(poseAt(165, 701, { confidence: 0.05 })).tracking?.signalQuality).toBe(
      'LOST',
    );
  });
});
