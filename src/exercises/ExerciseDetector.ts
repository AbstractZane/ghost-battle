import type { PoseResult } from '@/pose/poseTypes';

import type { ExerciseDetectionResult } from './pushup/pushupTypes';

export interface ExerciseDetector<TResult = ExerciseDetectionResult> {
  reset(): void;
  setPaused(paused: boolean): void;
  processPose(pose: PoseResult, timestamp: number): TResult;
}

export interface ExerciseContextDetector<TState> {
  reset(): void;
  update(plausible: boolean, fresh: boolean, timestamp: number): TState;
}

export interface FormAnalyzer<TRep, TResult> {
  analyze(rep: TRep): TResult;
}
