import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';

/** Calibration follows the active counter's arming decision; no separate pose model gate. */
export function calibrationGate(result: ExerciseDetectionResult): {
  ready: boolean;
  hint: string;
} {
  const { metrics } = result;
  if (metrics.exerciseVariant === 'MODIFIED_KNEE') {
    return { ready: false, hint: 'Straighten your legs for standard push-ups.' };
  }
  if (metrics.contextState !== 'PUSHUP') {
    return { ready: false, hint: 'Move into a visible plank position.' };
  }
  if (metrics.armState === 'ARMED') {
    // Counters can remain armed through brief UNKNOWN lower-body evidence. Do not
    // invent a stricter calibration gate than the active counter.
    return { ready: true, hint: 'Hold this top position through the countdown.' };
  }
  if (metrics.exerciseVariant !== 'STANDARD') {
    return { ready: false, hint: 'Make sure your legs and feet are visible.' };
  }
  if (!metrics.armSignalReliable || metrics.signalQuality !== 'GOOD') {
    return { ready: false, hint: 'Keep your shoulder, elbow, and wrist in view.' };
  }
  return { ready: false, hint: 'Straighten your arms and hold the top position.' };
}
