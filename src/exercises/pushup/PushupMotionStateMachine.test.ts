import { describe, expect, it } from 'vitest';

import { PushupMotionStateMachine } from './PushupMotionStateMachine';
import { DEFAULT_PUSHUP_RULES } from './pushupRules';

function runAngles(
  machine: PushupMotionStateMachine,
  samples: Array<[number, number]>,
  seed: [number, number] | undefined = [165, 0],
) {
  let previous = seed;
  return samples.map(([angle, timestamp]) => {
    const velocity = previous
      ? ((angle - previous[0]) * 1000) / (timestamp - previous[1])
      : undefined;
    previous = [angle, timestamp];
    return machine.update({
      timestamp,
      elbowAngle: angle,
      elbowVelocity: velocity,
      reliable: true,
    });
  });
}

describe('PushupMotionStateMachine', () => {
  it('recognizes observed bottom and top when intermediate frames are absent', () => {
    const machine = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    machine.armAtTop(165, 0);
    const results = runAngles(machine, [
      [82, 300],
      [165, 600],
      [165, 700],
    ]);
    expect(results[0]?.bottomConfirmed).toBe(true);
    expect(results.filter((result) => result.candidateCompleted)).toHaveLength(1);
  });

  it('requires consecutive evidence for a marginal bottom', () => {
    const machine = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    machine.armAtTop(165, 0);
    const results = runAngles(machine, [
      [140, 100],
      [89, 200],
      [100, 230],
      [89, 280],
      [115, 310],
      [165, 450],
    ]);
    expect(results.some((result) => result.bottomConfirmed)).toBe(false);
    expect(results.some((result) => result.candidateCompleted)).toBe(false);
  });
  it('recognizes the ordered top-bottom-top cycle', () => {
    const machine = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    machine.armAtTop(165, 0);
    const results = runAngles(machine, [
      [140, 100],
      [84, 220],
      [112, 340],
      [155, 500],
    ]);
    expect(results.filter((result) => result.candidateCompleted)).toHaveLength(1);
    expect(results.at(-1)?.completionMode).toBe('SAMPLED_TOP');
  });

  it('recovers a missed sampled lockout only after a near-top reversal', () => {
    const machine = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    machine.armAtTop(165, 0);
    const results = runAngles(machine, [
      [140, 80],
      [84, 180],
      [112, 280],
      [138, 350],
      [149, 420],
      [152, 480],
      [147, 540],
      [135, 620],
    ]);
    expect(results.filter((result) => result.candidateCompleted)).toHaveLength(1);
    expect(results.find((result) => result.candidateCompleted)?.completionMode).toBe(
      'PEAK_REVERSAL',
    );
  });

  it('does not infer completion from a partial 145 degree peak', () => {
    const machine = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    machine.armAtTop(165, 0);
    const results = runAngles(machine, [
      [140, 80],
      [84, 180],
      [112, 280],
      [135, 360],
      [143, 430],
      [145, 500],
      [140, 570],
    ]);
    expect(results.some((result) => result.candidateCompleted)).toBe(false);
  });

  it('does not duplicate a completion during near-top jitter', () => {
    const machine = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    machine.armAtTop(165, 0);
    const results = runAngles(machine, [
      [140, 80],
      [84, 180],
      [112, 280],
      [152, 400],
      [149, 450],
      [153, 500],
      [150, 550],
      [147, 600],
    ]);
    expect(results.filter((result) => result.candidateCompleted)).toHaveLength(1);
  });

  it('cannot start a candidate from the bottom or complete top-only movement', () => {
    const bottom = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    expect(
      runAngles(
        bottom,
        [
          [84, 0],
          [112, 100],
          [165, 220],
        ],
        undefined,
      ).some((r) => r.candidateCompleted),
    ).toBe(false);
    const top = new PushupMotionStateMachine({ ...DEFAULT_PUSHUP_RULES });
    top.armAtTop(165, 0);
    expect(
      runAngles(top, [
        [152, 100],
        [165, 200],
        [152, 300],
      ]).some((r) => r.candidateCompleted),
    ).toBe(false);
  });
});
