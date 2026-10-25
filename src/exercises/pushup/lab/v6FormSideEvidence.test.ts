import { describe, expect, it } from 'vitest';
import { poseAt, validRepSequence } from '@/tests/poseFixtures';
import { LAB_V6_FORM_RULES } from '../pushupRules';
import { PushupDetectorV6 } from '../v6/PushupDetectorV6';

/** Measured phone angle/timing patterns on synthetic geometry, NOT raw phone poses.
 * These reproduce scalar counter failures, not camera recognition accuracy. */
function runSamples(samples: readonly (readonly [number, number])[]) {
  const detector = new PushupDetectorV6({ ...LAB_V6_FORM_RULES });
  return samples.map(([angle, timestamp]) => detector.processPose(poseAt(angle, timestamp)));
}

describe('V6 Form side-test counter regressions', () => {
  it('does not count the brief 84.8-degree bottom observed during the first quarter rep', () => {
    const results = runSamples([
      [171.9, 0],
      [171.9, 180],
      [165.7, 800],
      [165.7, 1000],
      [134.9, 1408],
      [116.2, 1499],
      [96.3, 1662],
      [84.7718958764475, 1752],
      [87.3, 1833],
      [112.6, 1997],
      [130.6, 2076],
      [145.7, 2168],
      [171, 2335],
    ]);
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.some((result) => result.rejectedReason === 'INSUFFICIENT_DEPTH')).toBe(true);
  });

  it('does not count the 90-degree marginal bottom from the second quarter rep', () => {
    const results = runSamples([
      [171, 0],
      [171, 180],
      [171, 650],
      [138.6, 875],
      [120.6, 953],
      [112.1, 1035],
      [94.8, 1209],
      [90.2, 1291],
      [114, 1455],
      [128, 1540],
      [145.8, 1621],
    ]);
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('cannot stitch a rep through the standing-stage impossible angle jumps', () => {
    const results = runSamples([
      [165, 0],
      [165, 180],
      [21.8, 260],
      [168.8, 337],
      [6.4, 429],
      [10, 500],
      [15, 700],
      [168.2, 1259],
    ]);
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.some((result) => result.rejectedReason === 'IMPOSSIBLE_MOTION')).toBe(true);
  });

  it('preserves a corroborated 85-degree rep without changing arm readiness', () => {
    const detector = new PushupDetectorV6({ ...LAB_V6_FORM_RULES });
    const results = validRepSequence().map((pose) => detector.processPose(pose));
    expect(results.at(-1)?.totalReps).toBe(1);
    expect(results.some((result) => result.state === 'UP')).toBe(true);
  });

  it('recovers after an artifact without erasing previously accepted reps', () => {
    const detector = new PushupDetectorV6({ ...LAB_V6_FORM_RULES });
    validRepSequence().forEach((pose) => detector.processPose(pose));
    expect(detector.processPose(poseAt(165, 1500)).totalReps).toBe(1);
    const artifact = detector.processPose(poseAt(10, 1560));
    expect(artifact.rejectedReason).toBe('IMPOSSIBLE_MOTION');
    expect(artifact.totalReps).toBe(1);
    const results = validRepSequence(2000).map((pose) => detector.processPose(pose));
    expect(results.at(-1)?.totalReps).toBe(2);
  });
});
