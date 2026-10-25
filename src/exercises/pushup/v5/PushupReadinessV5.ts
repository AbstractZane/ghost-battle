import { DEFAULT_PUSHUP_RULES, type PushupRules } from '@/exercises/pushup/pushupRules';
import { calculateAngle, landmarkDistance } from '@/pose/poseMath';
import {
  evaluatePoseQuality,
  poseSourceGeometry,
  type PoseGeometryDiagnostics,
  type PoseReadinessThresholds,
} from '@/pose/poseQuality';
import { landmarksForSide } from '@/pose/sideSelector';
import type { PoseLandmark, PoseLandmarkName, PoseResult, PoseSide } from '@/pose/poseTypes';

import { TemporalSideSelectorV5 } from './TemporalSideSelectorV5';
import { hasFrontViewPlankSupport } from '../frontViewPlank';
import {
  READINESS_REASON_LABELS_V5,
  type PushupReadinessReasonV5,
  type PushupReadinessV5Result,
} from './v5Types';

interface QualitySample {
  timestamp: number;
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
  stability: number;
}

type AveragedQuality = Omit<QualitySample, 'timestamp'>;

interface FrameGeometry {
  bodySpan: number | null;
  bodyAngle: number | null;
  torsoAngle: number | null;
  bilateralRatio: number | null;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function aspectCorrected(
  landmark: PoseLandmark | undefined,
  pose: Pick<PoseResult, 'sourceWidth' | 'sourceHeight'>,
): PoseLandmark | undefined {
  if (!landmark) return undefined;
  const maximum = Math.max(pose.sourceWidth, pose.sourceHeight);
  if (!Number.isFinite(maximum) || maximum <= 0) return undefined;
  return {
    ...landmark,
    // PoseResult coordinates already preserve source aspect ratio.
    x: landmark.x,
    y: landmark.y,
  };
}

function mean(values: ReadonlyArray<number>): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: ReadonlyArray<number>): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return mean([sorted[middle - 1] ?? 0, sorted[middle] ?? 0]);
}

function reasonPriority(reason: PushupReadinessReasonV5 | null): number {
  if (reason === 'NO_PERSON') return 1;
  if (reason === 'MOVE_FARTHER_BACK' || reason === 'MOVE_CLOSER') return 2;
  if (reason === 'ARM_NOT_VISIBLE' || reason === 'HIP_NOT_VISIBLE') return 3;
  if (reason === 'FULL_BODY_NOT_VISIBLE') return 4;
  if (reason === 'GET_INTO_PUSHUP_POSITION') return 5;
  if (reason === 'POSE_UNSTABLE') return 6;
  if (reason === 'HOLD_STILL') return 7;
  return 0;
}

/** Temporal, explainable readiness evaluator used by the V5 detector and replay harness. */
export class PushupReadinessV5 {
  private readonly sideSelector: TemporalSideSelectorV5;
  private samples: QualitySample[] = [];
  private sampleSide: PoseSide | null = null;
  private readyEvidenceSince: number | null = null;
  private lastPassingAt: number | null = null;
  private stableReady = false;
  private lastGeometry: PoseGeometryDiagnostics | null = null;

  constructor(private readonly rules: PushupRules = { ...DEFAULT_PUSHUP_RULES }) {
    this.sideSelector = new TemporalSideSelectorV5(rules);
  }

  reset(): void {
    this.sideSelector.reset();
    this.samples = [];
    this.sampleSide = null;
    this.readyEvidenceSince = null;
    this.lastPassingAt = null;
    this.stableReady = false;
    this.lastGeometry = null;
  }

  update(pose: PoseResult, timestamp = pose.timestamp): PushupReadinessV5Result {
    const selection = this.sideSelector.update(pose.landmarks, timestamp);
    if (selection.changed || this.sampleSide !== selection.side) {
      this.samples = [];
      this.sampleSide = selection.side;
      this.readyEvidenceSince = null;
    }
    const selected = selection.side === 'left' ? selection.left : selection.right;
    this.samples.push({ timestamp, ...selected.landmarks, stability: selected.stability });
    this.samples = this.samples.filter(
      (sample) => timestamp - sample.timestamp <= this.rules.v5ReadinessWindowMs,
    );

    const stability = median(this.samples.map((sample) => sample.stability));
    const averages: AveragedQuality = {
      shoulder: mean(this.samples.map((sample) => sample.shoulder)),
      elbow: mean(this.samples.map((sample) => sample.elbow)),
      wrist: mean(this.samples.map((sample) => sample.wrist)),
      hip: mean(this.samples.map((sample) => sample.hip)),
      knee: mean(this.samples.map((sample) => sample.knee)),
      ankle: mean(this.samples.map((sample) => sample.ankle)),
      stability,
    };
    const geometry = this.geometry(pose, selection.side);
    const thresholds = this.thresholds();
    const legacyGeometry = evaluatePoseQuality(
      pose.landmarks,
      selection.side,
      thresholds,
      poseSourceGeometry(pose),
    ).geometry;
    if (legacyGeometry?.failure === null) this.lastGeometry = legacyGeometry;

    const entry = !this.stableReady;
    const criticalThreshold = entry
      ? this.rules.v5CriticalConfidenceEnter
      : this.rules.v5CriticalConfidenceRemain;
    const poseQuality = this.poseQuality(averages, stability, geometry, legacyGeometry);
    let reason = this.failureReason(pose, averages, geometry, legacyGeometry, criticalThreshold);
    const rawPassing = reason === null;

    if (rawPassing) {
      this.lastPassingAt = timestamp;
      this.readyEvidenceSince ??= timestamp;
      if (timestamp - this.readyEvidenceSince >= this.rules.v5ReadyConfirmationMs) {
        this.stableReady = true;
      } else {
        reason = 'HOLD_STILL';
      }
    } else if (
      this.stableReady &&
      this.lastPassingAt !== null &&
      timestamp - this.lastPassingAt <= this.rules.v5ReadyExitGraceMs
    ) {
      reason = null;
    } else {
      this.stableReady = false;
      this.readyEvidenceSince = null;
    }

    const freshCriticalLandmarks = this.freshCriticalLandmarks(pose, selection.side);
    const ready = this.stableReady && reason === null;
    const feedback = ready ? 'READY' : READINESS_REASON_LABELS_V5[reason ?? 'HOLD_STILL'];
    return {
      version: 'V5',
      state: ready ? 'READY' : reason === 'NO_PERSON' ? 'NO_PERSON' : 'POSITIONING',
      feedback,
      visible: reason !== 'NO_PERSON',
      side: selection.side,
      requiredLandmarks: {
        shoulder: averages.shoulder,
        elbow: averages.elbow,
        wrist: averages.wrist,
        hip: averages.hip,
        knee: averages.knee,
        ankle: averages.ankle,
      },
      coreScore: mean([averages.shoulder, averages.elbow, averages.wrist, averages.hip]),
      supportingScore: mean([averages.knee, averages.ankle]),
      thresholds,
      geometry: legacyGeometry ?? this.lastGeometry,
      failureReason: reason ? READINESS_REASON_LABELS_V5[reason] : null,
      failurePriority: reasonPriority(reason),
      reason,
      poseQuality,
      stability,
      sideScoreLeft: selection.left.score,
      sideScoreRight: selection.right.score,
      sideChanged: selection.changed,
      sideSelectionReason: selection.reason,
      sideSelectionAlternativeBetterMs: selection.alternativeBetterMs,
      freshCriticalLandmarks,
    };
  }

  private thresholds(): PoseReadinessThresholds {
    return {
      individualCoreFloor: this.rules.v5CriticalConfidenceRemain,
      coreAggregate: this.rules.v5CriticalConfidenceEnter,
      supporting: this.rules.v5SupportingConfidenceEnter,
      bilateralCore: this.rules.orientationLandmarkConfidence,
      minimumCoreSegmentLength: this.rules.minimumCoreSegmentLength,
      minimumTorsoLength: this.rules.minimumTorsoLength,
      maximumTorsoLength: this.rules.maximumTorsoLength,
      minimumArmToTorsoRatio: this.rules.minimumArmToTorsoRatio,
      maximumArmToTorsoRatio: this.rules.maximumArmToTorsoRatio,
      maximumBilateralSeparationToTorsoRatio: this.rules.maximumBilateralSeparationToTorsoRatio,
    };
  }

  private geometry(pose: PoseResult, side: PoseSide): FrameGeometry {
    const names = landmarksForSide(side);
    const shoulder = aspectCorrected(pose.landmarks[names.shoulder], pose);
    const hip = aspectCorrected(pose.landmarks[names.hip], pose);
    const knee = aspectCorrected(pose.landmarks[names.knee], pose);
    const ankle = aspectCorrected(pose.landmarks[names.ankle], pose);
    const endpoint =
      ankle && ankle.confidence >= this.rules.v5SupportingConfidenceEnter ? ankle : knee;
    const torsoX = shoulder && hip ? Math.abs(hip.x - shoulder.x) : 0;
    const torsoY = shoulder && hip ? Math.abs(hip.y - shoulder.y) : 0;
    const torsoAngle =
      shoulder && hip && torsoX + torsoY > 0 ? (Math.atan2(torsoY, torsoX) * 180) / Math.PI : null;
    const shoulderWidth = landmarkDistance(
      aspectCorrected(pose.landmarks.leftShoulder, pose),
      aspectCorrected(pose.landmarks.rightShoulder, pose),
    );
    const hipWidth = landmarkDistance(
      aspectCorrected(pose.landmarks.leftHip, pose),
      aspectCorrected(pose.landmarks.rightHip, pose),
    );
    const torsoLength = landmarkDistance(shoulder, hip);
    return {
      bodySpan: landmarkDistance(shoulder, endpoint),
      bodyAngle: calculateAngle(shoulder, hip, endpoint),
      torsoAngle,
      bilateralRatio:
        shoulderWidth !== null && hipWidth !== null && torsoLength !== null && torsoLength > 0
          ? (shoulderWidth + hipWidth) / 2 / torsoLength
          : null,
    };
  }

  private poseQuality(
    averages: AveragedQuality,
    stability: number,
    geometry: FrameGeometry,
    legacyGeometry: PoseGeometryDiagnostics | null,
  ): number {
    const critical = mean([averages.shoulder, averages.elbow, averages.wrist, averages.hip]);
    const supporting = mean([averages.knee, averages.ankle]);
    const geometryScore =
      geometry.bodyAngle !== null &&
      geometry.torsoAngle !== null &&
      legacyGeometry?.failure === null
        ? 1
        : 0;
    const framing =
      geometry.bodySpan !== null &&
      geometry.bodySpan >= this.rules.v5MinimumBodySpan &&
      geometry.bodySpan <= this.rules.v5MaximumBodySpan
        ? 1
        : 0;
    return Math.round(
      clamp(
        critical * 0.4 + supporting * 0.15 + stability * 0.2 + geometryScore * 0.15 + framing * 0.1,
      ) * 100,
    );
  }

  private failureReason(
    pose: PoseResult,
    averages: AveragedQuality,
    geometry: FrameGeometry,
    legacyGeometry: PoseGeometryDiagnostics | null,
    criticalThreshold: number,
  ): PushupReadinessReasonV5 | null {
    const left = pose.landmarks.leftShoulder?.confidence ?? 0;
    const right = pose.landmarks.rightShoulder?.confidence ?? 0;
    const leftHip = pose.landmarks.leftHip?.confidence ?? 0;
    const rightHip = pose.landmarks.rightHip?.confidence ?? 0;
    if (Math.max(left, right, leftHip, rightHip) < this.rules.v5CriticalConfidenceRemain) {
      return 'NO_PERSON';
    }
    if (geometry.bodySpan !== null && geometry.bodySpan > this.rules.v5MaximumBodySpan) {
      return 'MOVE_FARTHER_BACK';
    }
    if (geometry.bodySpan !== null && geometry.bodySpan < this.rules.v5MinimumBodySpan) {
      return 'MOVE_CLOSER';
    }
    if (averages.hip < criticalThreshold) return 'HIP_NOT_VISIBLE';
    if (
      averages.shoulder < criticalThreshold ||
      averages.elbow < criticalThreshold ||
      averages.wrist < criticalThreshold
    ) {
      return 'ARM_NOT_VISIBLE';
    }
    // V5's local counter must not require visible ankles or knees before it
    // can start a rep. They are often occluded by clothing or projection; arm
    // motion and plausible torso geometry remain the readiness contract.
    // Bilateral width is deliberately diagnostic-only. It varies dramatically
    // with camera viewpoint and must not make an otherwise visible, plausible
    // pushup setup fail readiness. Body/arm geometry and lower-body visibility
    // remain required below.
    if (
      geometry.bodyAngle === null ||
      geometry.bodyAngle < this.rules.severeBodyAngle ||
      geometry.torsoAngle === null ||
      (geometry.torsoAngle > this.rules.v5MaximumTorsoAngle &&
        !hasFrontViewPlankSupport(pose, this.sampleSide ?? 'left', this.rules)) ||
      (legacyGeometry !== null && legacyGeometry.failure !== null)
    ) {
      return 'GET_INTO_PUSHUP_POSITION';
    }
    // Stability and aggregate quality stay diagnostic-only for the lenient
    // local V5 path. Requiring a still full-body hold was the dominant source
    // of missed real reps in browser camera traces.
    return null;
  }

  private freshCriticalLandmarks(pose: PoseResult, side: PoseSide): PoseLandmarkName[] {
    const names = landmarksForSide(side);
    const critical = [names.shoulder, names.elbow, names.wrist, names.hip] as PoseLandmarkName[];
    if (pose.tracking) {
      return critical.filter((name) => pose.tracking?.freshLandmarks.includes(name));
    }
    return critical.filter(
      (name) => (pose.landmarks[name]?.confidence ?? 0) >= this.rules.v5CriticalConfidenceRemain,
    );
  }
}
