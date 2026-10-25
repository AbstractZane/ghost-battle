import { clamp, scoreRange } from '@/pose/poseMath';
import type { FormGrade } from '@/types/models';

export interface RepQualityInput {
  minimumElbowAngle: number;
  maximumElbowAngle: number;
  averageBodyAngle: number;
  averageConfidence: number;
  durationMs: number;
}

export function calculateRepQuality(input: RepQualityInput): number {
  const depthScore = clamp(((115 - input.minimumElbowAngle) / 35) * 100, 0, 100);
  const extensionScore = scoreRange(input.maximumElbowAngle, 135, 165);
  const rangeOfMotion = (depthScore + extensionScore) / 2;
  const alignment = scoreRange(input.averageBodyAngle, 135, 175);
  const confidence = scoreRange(input.averageConfidence, 0.45, 0.9);
  const distanceFromIdealDuration = Math.abs(input.durationMs - 1800);
  const stability = clamp(100 - (distanceFromIdealDuration / 3200) * 45, 45, 100);

  return Math.round(rangeOfMotion * 0.35 + alignment * 0.3 + stability * 0.2 + confidence * 0.15);
}

export function formGrade(score: number): FormGrade {
  if (score >= 90) return 'Perfect';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Okay';
  return 'Poor';
}
