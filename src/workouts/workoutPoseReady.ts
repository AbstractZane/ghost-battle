import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';
import { calibrationGate } from './calibrationGate';

/** Use the active counter's observed top, not V4's separate visibility tracker. */
export function workoutPoseReady(result: ExerciseDetectionResult | null): boolean {
  return (
    result !== null &&
    result.state === 'UP' &&
    result.metrics.armSignalReliable &&
    result.metrics.signalQuality !== 'LOST' &&
    calibrationGate(result).ready
  );
}

/** Setup must observe poses; scoring is separately gated/reset at match start. */
export function workoutPoseTrackingEnabled(phase: string): boolean {
  return ['positioning', 'ready', 'countdown', 'go', 'active'].includes(phase);
}
