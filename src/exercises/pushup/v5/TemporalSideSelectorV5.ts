import type { PushupRules } from '@/exercises/pushup/pushupRules';
import { confidenceForSide, landmarksForSide } from '@/pose/sideSelector';
import type { PoseLandmark, PoseLandmarks, PoseSide } from '@/pose/poseTypes';

import type { SideQualityV5, SideSelectionV5 } from './v5Types';

interface SideTrack {
  score: number;
  shoulder?: PoseLandmark;
  hip?: PoseLandmark;
  timestamp?: number;
}

const STABILITY_REFERENCE_MS = 80;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function landmarkMotion(previous: PoseLandmark | undefined, current: PoseLandmark | undefined) {
  if (!previous || !current) return 0;
  return Math.hypot(current.x - previous.x, current.y - previous.y);
}

/** Rolling multi-landmark side quality with lock time, margin, and sustained failover. */
export class TemporalSideSelectorV5 {
  private selected: PoseSide | null = null;
  private selectedAt = 0;
  private candidate: PoseSide | null = null;
  private candidateSince = 0;
  private readonly tracks: Record<PoseSide, SideTrack> = {
    left: { score: 0 },
    right: { score: 0 },
  };

  constructor(private readonly rules: PushupRules) {}

  reset(): void {
    this.selected = null;
    this.selectedAt = 0;
    this.candidate = null;
    this.candidateSince = 0;
    this.tracks.left = { score: 0 };
    this.tracks.right = { score: 0 };
  }

  update(landmarks: PoseLandmarks, timestamp: number): SideSelectionV5 {
    const left = this.quality(landmarks, 'left', timestamp);
    const right = this.quality(landmarks, 'right', timestamp);
    if (this.selected === null) {
      this.selected = right.score > left.score ? 'right' : 'left';
      this.selectedAt = timestamp;
      return {
        side: this.selected,
        left,
        right,
        changed: false,
        reason: `initialized ${this.selected}: stronger rolling side quality`,
        alternativeBetterMs: 0,
      };
    }

    const selectedQuality = this.selected === 'left' ? left : right;
    const alternate: PoseSide = this.selected === 'left' ? 'right' : 'left';
    const alternateQuality = alternate === 'left' ? left : right;
    const locked = timestamp - this.selectedAt < this.rules.v5SideLockMs;
    const selectedEmergency =
      selectedQuality.landmarks.shoulder < this.rules.v5CriticalConfidenceRemain ||
      selectedQuality.landmarks.elbow < this.rules.v5CriticalConfidenceRemain ||
      selectedQuality.landmarks.hip < this.rules.v5CriticalConfidenceRemain;
    const alternateUsable =
      alternateQuality.landmarks.shoulder >= this.rules.v5CriticalConfidenceEnter &&
      alternateQuality.landmarks.elbow >= this.rules.v5CriticalConfidenceEnter &&
      alternateQuality.landmarks.hip >= this.rules.v5CriticalConfidenceEnter;
    const meaningfullyBetter =
      alternateQuality.score >= selectedQuality.score + this.rules.v5SideSwitchMargin;
    const shouldChallenge =
      alternateUsable && (selectedEmergency || (!locked && meaningfullyBetter));
    let changed = false;
    let alternativeBetterMs = 0;

    if (shouldChallenge) {
      if (this.candidate !== alternate) {
        this.candidate = alternate;
        this.candidateSince = timestamp;
      } else {
        alternativeBetterMs = Math.max(0, timestamp - this.candidateSince);
      }
      const confirmationMs = selectedEmergency
        ? this.rules.v5SideEmergencyConfirmationMs
        : this.rules.v5SideSwitchConfirmationMs;
      if (alternativeBetterMs >= confirmationMs) {
        const previous = this.selected;
        this.selected = alternate;
        this.selectedAt = timestamp;
        this.candidate = null;
        changed = true;
        return {
          side: this.selected,
          left,
          right,
          changed,
          reason: `switched ${previous} to ${alternate}: sustained quality advantage`,
          alternativeBetterMs,
        };
      }
      return {
        side: this.selected,
        left,
        right,
        changed,
        reason: `retained ${this.selected}: ${alternate} advantage ${alternativeBetterMs}/${confirmationMs}ms`,
        alternativeBetterMs,
      };
    }

    this.candidate = null;
    return {
      side: this.selected,
      left,
      right,
      changed,
      reason: locked
        ? `retained ${this.selected}: side lock active`
        : `retained ${this.selected}: no sustained quality advantage`,
      alternativeBetterMs,
    };
  }

  private quality(landmarks: PoseLandmarks, side: PoseSide, timestamp: number): SideQualityV5 {
    const confidence = confidenceForSide(landmarks, side);
    const names = landmarksForSide(side);
    const track = this.tracks[side];
    const shoulder = landmarks[names.shoulder];
    const hip = landmarks[names.hip];
    const frameTorsoMotion = Math.max(
      landmarkMotion(track.shoulder, shoulder),
      landmarkMotion(track.hip, hip),
    );
    const elapsedMs = track.timestamp === undefined ? 0 : timestamp - track.timestamp;
    const torsoMotion =
      elapsedMs > 0 ? frameTorsoMotion * (STABILITY_REFERENCE_MS / elapsedMs) : frameTorsoMotion;
    const stability = clamp(1 - torsoMotion / this.rules.v5MaximumStableTorsoMotion);
    const confidenceScore = confidence.coreScore * 0.8 + confidence.supportingScore * 0.2;
    const instantaneous = confidenceScore * 0.85 + stability * 0.15;
    track.score =
      track.score === 0
        ? instantaneous
        : track.score * (1 - this.rules.v5SideScoreAlpha) +
          instantaneous * this.rules.v5SideScoreAlpha;
    if (shoulder && shoulder.confidence >= this.rules.v5CriticalConfidenceRemain) {
      track.shoulder = { ...shoulder };
    }
    if (hip && hip.confidence >= this.rules.v5CriticalConfidenceRemain) {
      track.hip = { ...hip };
    }
    track.timestamp = timestamp;
    return {
      side,
      score: clamp(track.score),
      confidenceScore,
      stability,
      landmarks: confidence.landmarks,
    };
  }
}
