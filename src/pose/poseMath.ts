import type { PoseLandmark, PoseLandmarks } from './poseTypes';

const EPSILON = 1e-8;

export function calculateAngle(
  a: PoseLandmark | undefined,
  b: PoseLandmark | undefined,
  c: PoseLandmark | undefined,
): number | null {
  if (!a || !b || !c) return null;
  const values = [a.x, a.y, b.x, b.y, c.x, c.y];
  if (!values.every(Number.isFinite)) return null;

  const abX = a.x - b.x;
  const abY = a.y - b.y;
  const cbX = c.x - b.x;
  const cbY = c.y - b.y;
  const denominator = Math.hypot(abX, abY) * Math.hypot(cbX, cbY);
  if (denominator < EPSILON) return null;

  const cosine = Math.max(-1, Math.min(1, (abX * cbX + abY * cbY) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function landmarkDistance(a?: PoseLandmark, b?: PoseLandmark): number | null {
  if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function averageConfidence(
  landmarks: PoseLandmarks,
  names: ReadonlyArray<keyof PoseLandmarks>,
): number {
  const values = names
    .map((name) => landmarks[name]?.confidence)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function allLandmarksVisible(
  landmarks: PoseLandmarks,
  names: ReadonlyArray<keyof PoseLandmarks>,
  threshold: number,
): boolean {
  return names.every((name) => (landmarks[name]?.confidence ?? 0) >= threshold);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function scoreRange(value: number, bad: number, ideal: number): number {
  if (bad === ideal) return value >= ideal ? 100 : 0;
  return clamp(((value - bad) / (ideal - bad)) * 100, 0, 100);
}
