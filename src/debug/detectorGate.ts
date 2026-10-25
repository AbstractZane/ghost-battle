import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';
import { DEFAULT_PUSHUP_RULES, type PushupRules } from '@/exercises/pushup/pushupRules';
import type { PoseQualityResult } from '@/pose/poseQuality';

/** Human-readable first blocker, derived from the same public state the counter reports. */
export function detectorGate(
  version: string,
  result: ExerciseDetectionResult,
  readiness: PoseQualityResult | null,
  rules: Readonly<PushupRules> = DEFAULT_PUSHUP_RULES,
): string {
  const metrics = result.metrics;
  if (result.rejectedReason) return `REJECTED: ${result.rejectedReason}`;
  if (version === 'v5' && readiness && readiness.state !== 'READY') {
    return `READINESS: ${readiness.failureReason ?? readiness.state}`;
  }
  if (metrics.signalQuality === 'LOST') return 'TRACKING LOST';
  if (version === 'v5' && metrics.armState !== 'ARMED' && metrics.motionBodyEligible === false)
    return 'TOP POSTURE: BODY GEOMETRY / STABILITY';
  if (version !== 'v4') {
    return metrics.armState === 'ARMED'
      ? `PHASE: ${metrics.motionPhase}`
      : `ARM: ${metrics.armState}`;
  }
  if (metrics.contextState !== 'PUSHUP' && metrics.armState !== 'ARMED') {
    return `CONTEXT: ${metrics.contextState}`;
  }
  if (version === 'v4' && metrics.armState !== 'ARMED') {
    if (
      metrics.exerciseVariant !== 'STANDARD' &&
      !(metrics.frontViewPlankSupport === true && metrics.exerciseVariant === 'UNKNOWN')
    ) {
      return `VARIANT: ${metrics.exerciseVariant}`;
    }
    if (!metrics.armSignalReliable) return 'ARM LANDMARKS UNRELIABLE';
    if (metrics.elbowAngle === undefined) return 'ELBOW ANGLE UNAVAILABLE';
    if (metrics.elbowAngle < rules.upElbowAngle) {
      return `TOP ANGLE: ${metrics.elbowAngle.toFixed(0)} < ${rules.upElbowAngle}`;
    }
    return `ARMING TOP HOLD ${rules.armingConfirmationMs}ms`;
  }
  if (metrics.armState !== 'ARMED') return `ARM: ${metrics.armState}`;
  if (metrics.motionPhase === 'UP') {
    return `AWAIT DESCENT <= ${rules.leaveUpElbowAngle} + VELOCITY`;
  }
  if (metrics.motionPhase === 'DESCENDING') {
    return `AWAIT BOTTOM <= ${rules.downElbowAngle}`;
  }
  if (metrics.motionPhase === 'DOWN') {
    return `AWAIT ASCENT >= ${rules.leaveDownElbowAngle} + VELOCITY`;
  }
  if (metrics.motionPhase === 'ASCENDING') {
    return `AWAIT TOP >= ${rules.upElbowAngle}`;
  }
  return `PHASE: ${metrics.motionPhase}`;
}
