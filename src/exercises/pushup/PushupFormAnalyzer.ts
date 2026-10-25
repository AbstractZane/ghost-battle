import type { FormGrade } from '@/types/models';

import { calculateRepQuality, formGrade, type RepQualityInput } from './repQuality';

export interface PushupFormAnalysis {
  qualityScore: number;
  grade: FormGrade;
}

/** Scores an already-valid repetition; it never decides whether the repetition counts. */
export function analyzePushupForm(input: RepQualityInput): PushupFormAnalysis {
  const qualityScore = calculateRepQuality(input);
  return { qualityScore, grade: formGrade(qualityScore) };
}
