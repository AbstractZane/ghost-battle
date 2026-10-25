import { describe, expect, it } from 'vitest';

import { calculateAngle, landmarkDistance } from './poseMath';

const point = (x: number, y: number) => ({ x, y, confidence: 1 });

describe('pose math', () => {
  it('calculates a right angle', () =>
    expect(calculateAngle(point(1, 0), point(0, 0), point(0, 1))).toBeCloseTo(90));
  it('calculates a straight angle', () =>
    expect(calculateAngle(point(-1, 0), point(0, 0), point(1, 0))).toBeCloseTo(180));
  it('returns null for missing, invalid, and zero-length inputs', () => {
    expect(calculateAngle(undefined, point(0, 0), point(1, 0))).toBeNull();
    expect(calculateAngle(point(Number.NaN, 0), point(0, 0), point(1, 0))).toBeNull();
    expect(calculateAngle(point(0, 0), point(0, 0), point(1, 0))).toBeNull();
  });
  it('calculates landmark distance', () =>
    expect(landmarkDistance(point(0, 0), point(3, 4))).toBe(5));
});
