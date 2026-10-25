import { describe, expect, it } from 'vitest';
import { YOLOXPOSE_TINY } from './poseModels';
import { parseYoloPoseSample, YoloPoseAdapter, type YoloPoseSample } from './yoloPoseAdapter';

function sample(
  timestamp: number,
  overrides: Partial<YoloPoseSample['candidate']> = {},
): YoloPoseSample {
  const landmarks = Array.from({ length: 17 }, (_, index) => [0.2 + index * 0.01, 0.3, 0.8]).flat();
  return {
    capturedAt: timestamp,
    sourceWidth: 640,
    sourceHeight: 480,
    inputMirrored: false,
    orientation: 'up',
    inferenceLatencyMs: 24,
    candidate: {
      score: 0.8,
      secondScore: 0.05,
      bbox: [0.1, 0.1, 0.7, 0.8],
      landmarks,
      ...overrides,
    },
  };
}

describe('Android YOLO pose adapter', () => {
  it('keeps the same person through a brief absent pose without resetting a partial rep', () => {
    const adapter = new YoloPoseAdapter();
    adapter.process(sample(1000), 'back', false);
    expect(adapter.markAbsent(1125)).toBe(false);
    expect(adapter.process(sample(1250), 'back', false).kind).toBe('pose');
  });

  it('invalidates after sustained absence while preserving the timestamp watermark', () => {
    const adapter = new YoloPoseAdapter();
    adapter.process(sample(1000), 'back', false);
    expect(adapter.markAbsent(1700)).toBe(true);
    expect(adapter.process(sample(900), 'back', false).kind).toBe('absent');
  });

  it('validates native payload shape and never accepts malformed tensors', () => {
    expect(parseYoloPoseSample('{')).toBeNull();
    expect(
      parseYoloPoseSample(
        JSON.stringify({ state: 'pose', candidate: { score: 0.8, landmarks: [1] } }),
      ),
    ).toBeNull();
    expect(parseYoloPoseSample(JSON.stringify({ state: 'pose', candidate: { score: 0 } }))).toBe(
      'absent',
    );
    expect(parseYoloPoseSample(JSON.stringify({ state: 'pose', ...sample(1000) }))).toEqual(
      sample(1000),
    );
  });

  it('preserves capture time, model id, aspect and mirroring', () => {
    const result = new YoloPoseAdapter().process(
      { ...sample(1000), inputMirrored: true },
      'front',
      true,
    );
    expect(result.kind).toBe('pose');
    if (result.kind !== 'pose') return;
    expect(result.pose.timestamp).toBe(1000);
    expect(result.pose.poseModel).toBe(YOLOXPOSE_TINY);
    expect(result.pose.landmarks.nose?.x).toBeCloseTo(0.8);
    expect(result.pose.rawLandmarks.nose?.x).toBeCloseTo(0.2);
    expect(result.pose.landmarks.nose?.y).toBeCloseTo(0.225);
    expect(result.pose.sourceWidth).toBe(640);
  });

  it('invalidates a partial cycle on person loss and reacquires a new identity', () => {
    const adapter = new YoloPoseAdapter();
    expect(adapter.process(sample(1000), 'back', false).kind).toBe('pose');
    expect(adapter.markAbsent()).toBe(true);
    expect(adapter.markAbsent()).toBe(false);
    expect(adapter.process(sample(1100), 'back', false).kind).toBe('pose');
    const switched = sample(1200, { bbox: [0.75, 0.1, 0.98, 0.8] });
    expect(adapter.process(switched, 'back', false)).toEqual({
      kind: 'identity-changed',
      invalidate: true,
    });
    expect(
      adapter.process(sample(1300, { bbox: [0.76, 0.1, 0.98, 0.8] }), 'back', false).kind,
    ).toBe('reacquiring');
    expect(
      adapter.process(sample(1400, { bbox: [0.76, 0.1, 0.98, 0.8] }), 'back', false).kind,
    ).toBe('pose');
  });

  it('rejects simultaneous people and duplicate timestamps', () => {
    const adapter = new YoloPoseAdapter();
    expect(adapter.process(sample(1000), 'back', false).kind).toBe('pose');
    expect(adapter.process(sample(1050, { secondScore: 0.6 }), 'back', false)).toEqual({
      kind: 'ambiguous',
      invalidate: true,
    });
    expect(adapter.process(sample(1100), 'back', false).kind).toBe('pose');
    expect(adapter.process(sample(1100), 'back', false)).toEqual({
      kind: 'absent',
      invalidate: true,
    });
    expect(adapter.process(sample(1050), 'back', false)).toEqual({
      kind: 'absent',
      invalidate: false,
    });
    expect(adapter.process(sample(1200), 'back', false).kind).toBe('pose');
  });
});
