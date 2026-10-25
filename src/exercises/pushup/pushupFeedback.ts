import type { PushupState } from './pushupTypes';

export function getPushupFeedback(
  state: PushupState,
  elbowAngle: number,
  bodyAngle: number,
  minimumBodyAngle: number,
): string {
  if (bodyAngle < minimumBodyAngle) return 'KEEP BODY STRAIGHT';
  if (state === 'NOT_READY') return 'MOVE INTO TOP POSITION';
  if (state === 'UP') return 'DESCEND';
  if (state === 'DESCENDING' && elbowAngle > 90) return 'GO LOWER';
  if (state === 'DESCENDING') return 'GOOD DEPTH';
  if (state === 'DOWN') return 'PUSH';
  if (state === 'ASCENDING') return 'FULLY EXTEND';
  return 'READY';
}

export function qualityLabel(score: number): string {
  if (score >= 90) return 'PERFECT REP';
  if (score >= 75) return 'GOOD REP';
  if (score >= 60) return 'FULL REP';
  return 'REP COUNTED';
}
