import { describe, expect, it } from 'vitest';

import { DEFAULT_PUSHUP_RULES } from '@/exercises/pushup/pushupRules';

import { PushupStateMachineV5, type PushupStateInputV5 } from './PushupStateMachineV5';

function frame(
  timestamp: number,
  elbowAngle: number,
  elbowVelocity: number,
  options: Partial<PushupStateInputV5> = {},
): PushupStateInputV5 {
  return {
    timestamp,
    elbowAngle,
    elbowVelocity,
    reliable: true,
    ready: true,
    stableBody: true,
    sideChanged: false,
    ...options,
  };
}

function coherentCycle(machine: PushupStateMachineV5, impossible = false) {
  return [
    frame(0, 166, 0),
    frame(200, 166, 0),
    frame(300, 140, -100),
    frame(380, 135, impossible ? -1000 : -100),
    frame(500, 86, -100),
    frame(600, 84, 0),
    frame(700, 115, 100),
    frame(780, 125, 100),
    frame(900, 165, 100),
    frame(1000, 166, 0),
  ].map((input) => machine.update(input));
}

const PHYSICAL_REP: ReadonlyArray<readonly [number, number]> = [
  [0, 166],
  [400, 166],
  [600, 147],
  [800, 78],
  [1000, 70],
  [1200, 108],
  [1600, 166],
  [2000, 166],
];

function physicalAngleAt(timestamp: number): number {
  const nextIndex = PHYSICAL_REP.findIndex(([anchorTimestamp]) => anchorTimestamp >= timestamp);
  if (nextIndex <= 0) return PHYSICAL_REP[0]?.[1] ?? 166;
  const previous = PHYSICAL_REP[nextIndex - 1];
  const next = PHYSICAL_REP[nextIndex];
  if (!previous || !next) return PHYSICAL_REP.at(-1)?.[1] ?? 166;
  const progress = (timestamp - previous[0]) / (next[0] - previous[0]);
  return previous[1] + (next[1] - previous[1]) * progress;
}

function physicalRepAtFps(fps: number): PushupStateInputV5[] {
  const interval = 1000 / fps;
  const inputs: PushupStateInputV5[] = [];
  let previousTimestamp: number | null = null;
  let previousAngle: number | null = null;
  for (let index = 0; ; index += 1) {
    const timestamp = Math.round(index * interval);
    if (timestamp > 2000) break;
    const elbowAngle = physicalAngleAt(timestamp);
    const elapsed = previousTimestamp === null ? 0 : timestamp - previousTimestamp;
    inputs.push(
      frame(
        timestamp,
        elbowAngle,
        elapsed > 0 && previousAngle !== null ? ((elbowAngle - previousAngle) * 1000) / elapsed : 0,
      ),
    );
    previousTimestamp = timestamp;
    previousAngle = elbowAngle;
  }
  return inputs;
}

describe('PushupStateMachineV5', () => {
  it('completes one coherent six-phase cycle', () => {
    const results = coherentCycle(new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES }));
    expect(results.filter((result) => result.candidateCompleted)).toHaveLength(1);
    expect(results.at(-1)?.phase).toBe('TOP_CONFIRMED');
  });

  it.each([20, 15, 10, 5])('recognizes the same timestamped physical rep at %i FPS', (fps) => {
    const machine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    const results = physicalRepAtFps(fps).map((input) => machine.update(input));
    expect(results.filter((result) => result.candidateCompleted)).toHaveLength(1);
  });

  it('credits top evidence gathered while readiness is still confirming', () => {
    const machine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    expect(machine.update(frame(0, 166, 0, { ready: false })).phase).toBe('NOT_READY');
    expect(machine.update(frame(200, 166, 0, { ready: false })).phase).toBe('NOT_READY');
    expect(machine.update(frame(400, 166, 0)).phase).toBe('TOP');
  });

  it('retains two timestamped bottom observations across a delayed descent transition', () => {
    const machine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    const results = physicalRepAtFps(5).map((input) => machine.update(input));
    expect(results.some((result) => result.phase === 'BOTTOM')).toBe(true);
    expect(results.some((result) => result.candidateCompleted)).toBe(true);
  });

  it('confirms a real bottom when the next low-FPS sample has already started rising', () => {
    const machine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    const results = [
      frame(0, 166, 0),
      frame(200, 166, 0),
      frame(300, 140, -100),
      frame(380, 135, -100),
      frame(500, 78, -300),
      frame(620, 101, 190),
      frame(700, 120, 150),
      frame(800, 140, 150),
      frame(900, 165, 150),
      frame(1000, 166, 0),
    ].map((input) => machine.update(input));

    expect(results.some((result) => result.phase === 'BOTTOM')).toBe(true);
    expect(results.some((result) => result.candidateCompleted)).toBe(true);
  });

  it('does not accept a one-frame bottom spike', () => {
    const machine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    const results = [
      frame(0, 166, 0),
      frame(200, 166, 0),
      frame(300, 140, -100),
      frame(380, 135, -100),
      frame(500, 82, -100),
      frame(580, 116, 100),
      frame(700, 165, 100),
      frame(800, 166, 0),
    ].map((input) => machine.update(input));
    expect(results.some((result) => result.candidateCompleted)).toBe(false);
  });

  it('rejects angular motion marked as physically impossible', () => {
    const results = coherentCycle(new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES }), true);
    expect(results.at(-1)?.candidateCompleted).toBe(false);
    expect(results.at(-1)?.rejectionReason).toBe('IMPOSSIBLE_MOTION');
  });

  it('cannot begin a candidate from halfway down', () => {
    const machine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    const results = [
      frame(0, 120, 0),
      frame(200, 100, -100),
      frame(400, 84, -100),
      frame(600, 120, 100),
      frame(800, 166, 100),
      frame(1000, 166, 0),
    ].map((input) => machine.update(input));
    expect(results.some((result) => result.candidateStarted)).toBe(false);
    expect(results.some((result) => result.candidateCompleted)).toBe(false);
  });

  it('rejects sparse partial, unstable, impossible, and side-switch sequences', () => {
    const partial = physicalRepAtFps(5).map((input) => ({
      ...input,
      elbowAngle: Math.max(input.elbowAngle ?? 180, 120),
    }));
    const standing = physicalRepAtFps(5).map((input) => ({
      ...input,
      ready: false,
      stableBody: false,
    }));
    const cameraShake = physicalRepAtFps(5).map((input, index) =>
      index >= 4
        ? { ...input, ready: false, stableBody: false, sideChanged: index % 2 === 0 }
        : input,
    );
    const impossible = physicalRepAtFps(5).map((input, index) =>
      index === 4 ? { ...input, elbowVelocity: -1000 } : input,
    );
    const sideSwitch = physicalRepAtFps(5).map((input, index) =>
      index === 6 ? { ...input, sideChanged: true } : input,
    );

    for (const [name, inputs] of [
      ['partial', partial],
      ['standing', standing],
      ['camera shake', cameraShake],
      ['impossible', impossible],
      ['side switch', sideSwitch],
    ] as const) {
      const machine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
      const results = inputs.map((input) => machine.update(input));
      expect(
        results.some((result) => result.candidateCompleted),
        name,
      ).toBe(false);
    }
  });

  it('allows a brief unreliable gap but rejects sustained tracking loss', () => {
    const briefMachine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    const brief = physicalRepAtFps(10).map((input) =>
      input.timestamp === 1100 ? { ...input, reliable: false, elbowAngle: undefined } : input,
    );
    expect(
      brief.map((input) => briefMachine.update(input)).some((result) => result.candidateCompleted),
    ).toBe(true);

    const lostMachine = new PushupStateMachineV5({ ...DEFAULT_PUSHUP_RULES });
    const lost = physicalRepAtFps(10).map((input) =>
      input.timestamp >= 900 ? { ...input, reliable: false, elbowAngle: undefined } : input,
    );
    expect(
      lost
        .map((input) => lostMachine.update(input))
        .some((result) => result.rejectionReason === 'TRACKING_LOST'),
    ).toBe(true);
  });
});
