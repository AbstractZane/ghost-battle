import type { PoseLandmarks, PoseSide } from './poseTypes';

export const SIDE_NAMES = {
  left: ['leftShoulder', 'leftElbow', 'leftWrist', 'leftHip', 'leftKnee', 'leftAnkle'],
  right: ['rightShoulder', 'rightElbow', 'rightWrist', 'rightHip', 'rightKnee', 'rightAnkle'],
} as const;

export type SideLandmarkConfidences = Record<
  'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle',
  number
>;

export interface SideConfidenceSnapshot {
  landmarks: SideLandmarkConfidences;
  coreScore: number;
  supportingScore: number;
  aggregateScore: number;
}

export interface SideSelection {
  side: PoseSide;
  leftScore: number;
  rightScore: number;
  left: SideConfidenceSnapshot;
  right: SideConfidenceSnapshot;
  changed: boolean;
  reason: string;
  alternativeBetterMs: number;
}

export interface SideSelectionThresholds {
  individualCoreFloor: number;
  coreAggregate: number;
  sustainedFailureMs: number;
  emergencyFailureMs?: number;
}

const CORE_LANDMARKS = ['shoulder', 'elbow', 'wrist', 'hip'] as const;
const ARM_LANDMARKS = ['shoulder', 'elbow', 'wrist'] as const;

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function confidenceForSide(
  landmarks: PoseLandmarks,
  side: PoseSide,
): SideConfidenceSnapshot {
  const names = landmarksForSide(side);
  const values: SideLandmarkConfidences = {
    shoulder: landmarks[names.shoulder]?.confidence ?? 0,
    elbow: landmarks[names.elbow]?.confidence ?? 0,
    wrist: landmarks[names.wrist]?.confidence ?? 0,
    hip: landmarks[names.hip]?.confidence ?? 0,
    knee: landmarks[names.knee]?.confidence ?? 0,
    ankle: landmarks[names.ankle]?.confidence ?? 0,
  };
  const coreScore = median([values.shoulder, values.elbow, values.wrist, values.hip]);
  const supportingScore = median([values.knee, values.ankle]);
  return {
    landmarks: values,
    coreScore,
    supportingScore,
    aggregateScore: coreScore * 0.8 + supportingScore * 0.2,
  };
}

export class StableSideSelector {
  private selected: PoseSide = 'left';
  private initialized = false;
  private candidate: PoseSide | null = null;
  private candidateSince = 0;

  reset(): void {
    this.selected = 'left';
    this.initialized = false;
    this.candidate = null;
    this.candidateSince = 0;
  }

  select(
    landmarks: PoseLandmarks,
    timestamp: number,
    thresholds: SideSelectionThresholds,
  ): SideSelection {
    const left = confidenceForSide(landmarks, 'left');
    const right = confidenceForSide(landmarks, 'right');
    const leftScore = left.aggregateScore;
    const rightScore = right.aggregateScore;
    let reason: string;
    if (!this.initialized) {
      this.selected = rightScore > leftScore ? 'right' : 'left';
      this.initialized = true;
      reason = `initialized ${this.selected}: stronger weighted confidence`;
      return {
        side: this.selected,
        leftScore,
        rightScore,
        left,
        right,
        changed: false,
        reason,
        alternativeBetterMs: 0,
      };
    }
    const alternate: PoseSide = this.selected === 'left' ? 'right' : 'left';
    const selectedSnapshot = this.selected === 'left' ? left : right;
    const alternateSnapshot = alternate === 'left' ? left : right;
    const coreUsable = (snapshot: SideConfidenceSnapshot) =>
      snapshot.coreScore >= thresholds.coreAggregate &&
      CORE_LANDMARKS.every(
        (landmark) => snapshot.landmarks[landmark] >= thresholds.individualCoreFloor,
      );
    const selectedCoreUsable = coreUsable(selectedSnapshot);
    const alternateCoreUsable = coreUsable(alternateSnapshot);
    const armUsable = (snapshot: SideConfidenceSnapshot) =>
      ARM_LANDMARKS.every(
        (landmark) => snapshot.landmarks[landmark] >= thresholds.individualCoreFloor,
      );
    const emergencyArmFailover = !armUsable(selectedSnapshot) && armUsable(alternateSnapshot);
    let changed = false;
    let alternativeBetterMs = 0;

    if (!selectedCoreUsable && alternateCoreUsable) {
      if (this.candidate !== alternate) {
        this.candidate = alternate;
        this.candidateSince = timestamp;
      } else {
        alternativeBetterMs = Math.max(0, timestamp - this.candidateSince);
      }
      const failureMs = emergencyArmFailover
        ? (thresholds.emergencyFailureMs ?? thresholds.sustainedFailureMs)
        : thresholds.sustainedFailureMs;
      if (alternativeBetterMs >= failureMs) {
        const previous = this.selected;
        this.selected = alternate;
        this.candidate = null;
        changed = true;
        reason = `switched ${previous} to ${alternate}: selected core unusable and alternative usable for ${alternativeBetterMs}ms`;
      } else {
        reason = `retained ${this.selected}: ${alternate} usable while selected core unusable for ${alternativeBetterMs}/${failureMs}ms`;
      }
    } else {
      this.candidate = null;
      reason = selectedCoreUsable
        ? `retained ${this.selected}: selected core remains usable`
        : `retained ${this.selected}: alternative core is also unusable`;
    }

    return {
      side: this.selected,
      leftScore,
      rightScore,
      left,
      right,
      changed,
      reason,
      alternativeBetterMs,
    };
  }
}

export function landmarksForSide(side: PoseSide) {
  const prefix = side === 'left' ? 'left' : 'right';
  return {
    shoulder: `${prefix}Shoulder` as const,
    elbow: `${prefix}Elbow` as const,
    wrist: `${prefix}Wrist` as const,
    hip: `${prefix}Hip` as const,
    knee: `${prefix}Knee` as const,
    ankle: `${prefix}Ankle` as const,
  };
}
