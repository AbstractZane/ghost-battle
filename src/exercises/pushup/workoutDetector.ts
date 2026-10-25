import { PushupDetector } from './PushupDetector';
import { PushupDetectorV5 } from './v5/PushupDetectorV5';
import { PushupDetectorV6 } from './v6/PushupDetectorV6';
import {
  DEFAULT_PUSHUP_RULES,
  WORKOUT_V6_FORM_RULES,
  withLabFrontViewRules,
  type PushupRules,
} from './pushupRules';

export type PushupDetectorVersion = 'v4' | 'v5' | 'v6';
export const DEFAULT_WORKOUT_DETECTOR_VERSION: PushupDetectorVersion = 'v6';

const LAB_REFERENCE_RULES = withLabFrontViewRules(DEFAULT_PUSHUP_RULES);

/** Shared by native/web calibration and every live workout mode.
 * V6 here means Form; the comparison registry retains a separate V6 Base. */
export function getWorkoutPushupRules(
  version: PushupDetectorVersion = DEFAULT_WORKOUT_DETECTOR_VERSION,
  labFrontView = false,
): Readonly<PushupRules> {
  if (version === 'v6') return WORKOUT_V6_FORM_RULES;
  return labFrontView ? LAB_REFERENCE_RULES : DEFAULT_PUSHUP_RULES;
}

export function workoutDetectorLabel(version: PushupDetectorVersion): string {
  return version === 'v6' ? 'V6 FORM' : version.toUpperCase();
}

export function createWorkoutPushupDetector(
  version: PushupDetectorVersion = DEFAULT_WORKOUT_DETECTOR_VERSION,
  rules: Readonly<PushupRules> = getWorkoutPushupRules(version),
): PushupDetector | PushupDetectorV5 | PushupDetectorV6 {
  if (version === 'v6') return new PushupDetectorV6({ ...rules });
  return version === 'v5' ? new PushupDetectorV5({ ...rules }) : new PushupDetector({ ...rules });
}
