import type { ExerciseDetector } from '@/exercises/ExerciseDetector';
import { analyzePushupForm } from '@/exercises/pushup/PushupFormAnalyzer';
import { DEFAULT_PUSHUP_RULES, type PushupRules } from '@/exercises/pushup/pushupRules';
import { PushupVariantClassifier } from '@/exercises/pushup/PushupVariantClassifier';
import type {
  ExerciseDetectionResult,
  PushupCandidateEligibility,
  PushupMetrics,
  PushupState,
  RejectedRepReason,
} from '@/exercises/pushup/pushupTypes';
import { calculateAngle, landmarkDistance } from '@/pose/poseMath';
import { confidenceForSide, landmarksForSide } from '@/pose/sideSelector';
import type { PoseLandmark, PoseResult, PoseSide } from '@/pose/poseTypes';
import type { ExerciseRep } from '@/types/models';

import { PushupReadinessV5 } from './PushupReadinessV5';
import { hasFrontViewPlankSupport } from '../frontViewPlank';
import { PushupStateMachineV5 } from './PushupStateMachineV5';
import type { PushupDiagnosticsV5, PushupPhaseV5, PushupReadinessV5Result } from './v5Types';

interface CandidateAccumulatorV5 {
  startedAt: number;
  minimumElbowAngle: number;
  maximumElbowAngle: number;
  bodyAngleSum: number;
  bodySamples: number;
  confidenceSum: number;
  samples: number;
  severeAlignmentViolation: boolean;
  eligibility: PushupCandidateEligibility;
  standardVariantEvidenceMs: number;
  modifiedVariantEvidenceMs: number;
  lastVariantEvidenceAt: number;
  lastVariantFrameEvidence: 'STANDARD' | 'MODIFIED_KNEE' | 'UNKNOWN';
}

interface TimedAngle {
  angle: number;
  timestamp: number;
  side: PoseSide;
}

function legacyPhase(phase: PushupPhaseV5): PushupState {
  if (phase === 'TOP' || phase === 'TOP_CONFIRMED') return 'UP';
  if (phase === 'BOTTOM') return 'DOWN';
  return phase;
}

/** Parallel V5 candidate. It consumes the same normalized PoseResult as V4. */
export class PushupDetectorV5 implements ExerciseDetector {
  private rules: PushupRules;
  private readiness: PushupReadinessV5;
  private motion: PushupStateMachineV5;
  private readonly variant = new PushupVariantClassifier();
  private paused = false;
  private totalReps = 0;
  private previousAngle: TimedAngle | null = null;
  private accumulator: CandidateAccumulatorV5 | null = null;
  private lastReadiness: PushupReadinessV5Result | null = null;
  private lastDiagnostics: PushupDiagnosticsV5 | null = null;
  private lastRejection?: RejectedRepReason;
  private readinessLostAt: number | null = null;

  constructor(rules: PushupRules = { ...DEFAULT_PUSHUP_RULES }) {
    this.rules = rules;
    this.readiness = new PushupReadinessV5(rules);
    this.motion = new PushupStateMachineV5(rules);
  }

  setRules(rules: Partial<PushupRules>): void {
    this.rules = { ...this.rules, ...rules };
    this.readiness = new PushupReadinessV5(this.rules);
    this.motion = new PushupStateMachineV5(this.rules);
    this.resetRuntime();
  }

  getRules(): Readonly<PushupRules> {
    return this.rules;
  }

  getReadiness(): PushupReadinessV5Result | null {
    return this.lastReadiness;
  }

  getDiagnostics(): PushupDiagnosticsV5 | null {
    return this.lastDiagnostics;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.resetRuntime();
  }

  reset(): void {
    this.totalReps = 0;
    this.paused = false;
    this.readiness.reset();
    this.variant.reset();
    this.lastReadiness = null;
    this.lastDiagnostics = null;
    this.lastRejection = undefined;
    this.resetRuntime();
  }

  processPose(pose: PoseResult, timestamp = pose.timestamp): ExerciseDetectionResult {
    const readiness = this.readiness.update(pose, timestamp);
    this.lastReadiness = readiness;
    const side = readiness.side;
    const names = landmarksForSide(side);
    const sideConfidence = confidenceForSide(pose.landmarks, side);
    const otherSide = confidenceForSide(pose.landmarks, side === 'left' ? 'right' : 'left');
    const elbowAngle =
      calculateAngle(
        pose.landmarks[names.shoulder],
        pose.landmarks[names.elbow],
        pose.landmarks[names.wrist],
      ) ?? undefined;
    const elbowVelocity = this.elbowVelocity(elbowAngle, timestamp, side);
    const ankleUsable = sideConfidence.landmarks.ankle >= this.rules.v5SupportingConfidenceEnter;
    const kneeUsable = sideConfidence.landmarks.knee >= this.rules.v5SupportingConfidenceEnter;
    const bodyAlignmentSource = ankleUsable ? 'ankle' : kneeUsable ? 'knee' : 'unavailable';
    const endpoint =
      bodyAlignmentSource === 'ankle'
        ? pose.landmarks[names.ankle]
        : bodyAlignmentSource === 'knee'
          ? pose.landmarks[names.knee]
          : undefined;
    const bodyAngle =
      calculateAngle(pose.landmarks[names.shoulder], pose.landmarks[names.hip], endpoint) ??
      undefined;
    const torsoAngle = this.lineAngleFromHorizontal(
      pose.landmarks[names.shoulder],
      pose.landmarks[names.hip],
    );
    const bodySpan = landmarkDistance(pose.landmarks[names.shoulder], endpoint) ?? undefined;
    const variant = this.variant.update(pose, timestamp, {
      landmarkConfidence: this.rules.lowerBodyLandmarkConfidence,
      standardMinimumKneeAngle: this.rules.standardMinimumKneeAngle,
      modifiedMaximumKneeAngle: this.rules.modifiedMaximumKneeAngle,
      minimumLegChainAngle: this.rules.minimumLegChainAngle,
      standardMinimumAnkleExtensionRatio: this.rules.standardMinimumAnkleExtensionRatio,
      modifiedMinimumAnkleDeviationRatio: this.rules.modifiedMinimumAnkleDeviationRatio,
      confirmationMs: this.rules.lowerBodyVariantConfirmationMs,
      trackingGraceMs: this.rules.trackingGraceMs,
    });
    const freshArm = this.freshArm(pose, side);
    const reliable =
      elbowAngle !== undefined &&
      freshArm &&
      sideConfidence.landmarks.shoulder >= this.rules.v5CriticalConfidenceRemain &&
      sideConfidence.landmarks.elbow >= this.rules.v5CriticalConfidenceRemain &&
      sideConfidence.landmarks.wrist >= this.rules.v5CriticalConfidenceRemain &&
      pose.tracking?.signalQuality !== 'LOST';
    const candidateInProgress = this.motion.getDiagnostics(timestamp).candidateStartedAt !== null;
    const readyForMotion = readiness.state === 'READY' || candidateInProgress;
    const stableBody =
      (candidateInProgress || readiness.stability >= this.rules.v5StabilityRemain) &&
      bodyAngle !== undefined &&
      bodyAngle >= this.rules.severeBodyAngle &&
      torsoAngle !== undefined &&
      (torsoAngle <= this.rules.v5MaximumTorsoAngle ||
        hasFrontViewPlankSupport(pose, side, this.rules));

    if (readiness.state === 'READY') this.readinessLostAt = null;
    else this.readinessLostAt ??= timestamp;
    if (
      this.readinessLostAt !== null &&
      timestamp - this.readinessLostAt > this.rules.v5TrackingLossResetMs &&
      this.accumulator === null
    ) {
      this.motion.reset();
    }

    const update = this.motion.update({
      timestamp,
      elbowAngle,
      elbowVelocity,
      reliable: !this.paused && reliable,
      ready: !this.paused && readyForMotion,
      stableBody: !this.paused && stableBody,
      sideChanged: readiness.sideChanged,
    });
    if (update.candidateStarted && elbowAngle !== undefined) {
      this.accumulator = {
        startedAt: timestamp,
        minimumElbowAngle: elbowAngle,
        maximumElbowAngle: elbowAngle,
        bodyAngleSum: bodyAngle ?? 0,
        bodySamples: bodyAngle === undefined ? 0 : 1,
        confidenceSum: sideConfidence.aggregateScore,
        samples: 1,
        severeAlignmentViolation: bodyAngle !== undefined && bodyAngle < this.rules.severeBodyAngle,
        // A standard rep does not need a continuously visible ankle. Only
        // lower-body evidence gathered during this candidate may veto it.
        eligibility: 'PENDING_STANDARD',
        standardVariantEvidenceMs: 0,
        modifiedVariantEvidenceMs: 0,
        lastVariantEvidenceAt: timestamp,
        lastVariantFrameEvidence: variant.frameEvidence,
      };
    } else if (this.accumulator && reliable && elbowAngle !== undefined) {
      this.accumulator.minimumElbowAngle = Math.min(this.accumulator.minimumElbowAngle, elbowAngle);
      this.accumulator.maximumElbowAngle = Math.max(this.accumulator.maximumElbowAngle, elbowAngle);
      if (bodyAngle !== undefined) {
        this.accumulator.bodyAngleSum += bodyAngle;
        this.accumulator.bodySamples += 1;
        this.accumulator.severeAlignmentViolation ||= bodyAngle < this.rules.severeBodyAngle;
      }
      this.accumulator.confidenceSum += sideConfidence.aggregateScore;
      this.accumulator.samples += 1;
      this.accumulateVariantEvidence(this.accumulator, variant.frameEvidence, timestamp);
    }

    let rep: ExerciseRep | undefined;
    let rejectedReason = update.rejectionReason;
    if (update.candidateRejected) this.accumulator = null;
    if (update.candidateCompleted) {
      ({ rep, rejectedReason } = this.completeCandidate(timestamp));
    }
    if (rejectedReason) this.lastRejection = rejectedReason;
    if (rep) this.totalReps += 1;

    const phase = update.phase;
    const metrics: PushupMetrics = {
      elbowAngle,
      leftElbowAngle:
        calculateAngle(
          pose.landmarks.leftShoulder,
          pose.landmarks.leftElbow,
          pose.landmarks.leftWrist,
        ) ?? undefined,
      rightElbowAngle:
        calculateAngle(
          pose.landmarks.rightShoulder,
          pose.landmarks.rightElbow,
          pose.landmarks.rightWrist,
        ) ?? undefined,
      elbowSource: side,
      armSignalReliable: reliable,
      bodyAngle,
      kneeAngle: variant.kneeAngle,
      legChainAngle: variant.legChainAngle,
      ankleExtensionRatio: variant.ankleExtensionRatio,
      ankleDeviationRatio: variant.ankleDeviationRatio,
      variantConfidence: variant.confidence,
      exerciseVariant: variant.variant,
      variantFrameEvidence: variant.frameEvidence,
      variantSide: variant.side,
      confidence: sideConfidence.aggregateScore,
      selectedSide: side,
      leftVisibility: readiness.sideScoreLeft,
      rightVisibility: readiness.sideScoreRight,
      leftCoreConfidence: side === 'left' ? sideConfidence.coreScore : otherSide.coreScore,
      rightCoreConfidence: side === 'right' ? sideConfidence.coreScore : otherSide.coreScore,
      leftLandmarks: side === 'left' ? sideConfidence.landmarks : otherSide.landmarks,
      rightLandmarks: side === 'right' ? sideConfidence.landmarks : otherSide.landmarks,
      coreConfidence: sideConfidence.coreScore,
      supportingConfidence: sideConfidence.supportingScore,
      sideSelectionReason: readiness.sideSelectionReason,
      sideSelectionAlternativeBetterMs: readiness.sideSelectionAlternativeBetterMs,
      bodyAlignmentSource,
      torsoAngleFromHorizontal: torsoAngle,
      frontViewPlankSupport: hasFrontViewPlankSupport(pose, side, this.rules),
      motionBodyEligible: stableBody,
      bodySpan,
      armState:
        phase === 'NOT_READY' ? (readiness.state === 'READY' ? 'ARMING' : 'DISARMED') : 'ARMED',
      contextState:
        readiness.state === 'READY'
          ? 'PUSHUP'
          : readiness.visible
            ? 'ENTERING_PUSHUP'
            : 'NOT_PUSHUP',
      signalQuality:
        pose.tracking?.signalQuality ??
        (reliable ? 'GOOD' : readiness.visible ? 'DEGRADED' : 'LOST'),
      elbowVelocity,
      motionPhase: legacyPhase(phase),
      candidateActive: update.candidateActive,
      candidateEligibility: this.accumulator?.eligibility ?? 'INACTIVE',
      transitionAccepted: update.transitionAccepted,
      lastRejectionReason: this.lastRejection,
    };
    const result: ExerciseDetectionResult = {
      state: legacyPhase(phase),
      repCompleted: rep !== undefined,
      totalReps: this.totalReps,
      qualityScore: rep?.qualityScore,
      feedback: this.feedback(phase, readiness, rejectedReason, rep),
      metrics,
      rep,
      rejectedReason,
    };
    this.lastDiagnostics = {
      version: 'V5',
      readiness,
      activeSide: side,
      poseQuality: readiness.poseQuality,
      stability: readiness.stability,
      sideScoreLeft: readiness.sideScoreLeft,
      sideScoreRight: readiness.sideScoreRight,
      phase,
      elbowAngle,
      elbowVelocity,
      bodyLineMetric: bodyAngle,
      rejectionReason: rejectedReason ?? this.lastRejection,
      candidateActive: update.candidateActive,
      temporal: this.motion.getDiagnostics(timestamp),
    };
    return this.paused
      ? { ...result, feedback: 'PAUSED', repCompleted: false, rep: undefined }
      : result;
  }

  private completeCandidate(timestamp: number): {
    rep?: ExerciseRep;
    rejectedReason?: RejectedRepReason;
  } {
    const candidate = this.accumulator;
    this.accumulator = null;
    if (!candidate) return { rejectedReason: 'INVALID_SEQUENCE' };
    if (candidate.eligibility === 'MODIFIED_KNEE') {
      return { rejectedReason: 'MODIFIED_PUSHUP' };
    }
    if (candidate.severeAlignmentViolation || candidate.bodySamples === 0) {
      return { rejectedReason: 'BODY_ALIGNMENT' };
    }
    const durationMs = timestamp - candidate.startedAt;
    const averageBodyAngle = candidate.bodyAngleSum / candidate.bodySamples;
    const form = analyzePushupForm({
      minimumElbowAngle: candidate.minimumElbowAngle,
      maximumElbowAngle: candidate.maximumElbowAngle,
      averageBodyAngle,
      averageConfidence: candidate.confidenceSum / candidate.samples,
      durationMs,
    });
    return {
      rep: {
        index: this.totalReps + 1,
        timestamp,
        durationMs,
        minimumElbowAngle: Math.round(candidate.minimumElbowAngle),
        maximumElbowAngle: Math.round(candidate.maximumElbowAngle),
        averageBodyAngle: Math.round(averageBodyAngle),
        qualityScore: form.qualityScore,
        grade: form.grade,
      },
    };
  }

  private elbowVelocity(
    elbowAngle: number | undefined,
    timestamp: number,
    side: PoseSide,
  ): number | undefined {
    if (elbowAngle === undefined) return undefined;
    const previous = this.previousAngle;
    this.previousAngle = { angle: elbowAngle, timestamp, side };
    if (!previous || previous.side !== side || timestamp <= previous.timestamp) return undefined;
    if (timestamp - previous.timestamp > this.rules.trackingGraceMs) return undefined;
    return ((elbowAngle - previous.angle) * 1000) / (timestamp - previous.timestamp);
  }

  private freshArm(pose: PoseResult, side: PoseSide): boolean {
    if (!pose.tracking) return true;
    if (pose.tracking.signalQuality === 'LOST') return false;
    const names = landmarksForSide(side);
    return [names.shoulder, names.elbow, names.wrist].every((name) =>
      pose.tracking?.freshLandmarks.includes(name),
    );
  }

  private accumulateVariantEvidence(
    candidate: CandidateAccumulatorV5,
    frameEvidence: 'STANDARD' | 'MODIFIED_KNEE' | 'UNKNOWN',
    timestamp: number,
  ): void {
    const elapsed = Math.min(
      this.rules.trackingGraceMs,
      Math.max(0, timestamp - candidate.lastVariantEvidenceAt),
    );
    candidate.lastVariantEvidenceAt = timestamp;
    if (frameEvidence === 'STANDARD') {
      candidate.standardVariantEvidenceMs =
        candidate.lastVariantFrameEvidence === 'STANDARD'
          ? candidate.standardVariantEvidenceMs + elapsed
          : 0;
    } else {
      candidate.standardVariantEvidenceMs = 0;
    }
    if (
      frameEvidence === 'MODIFIED_KNEE' &&
      candidate.lastVariantFrameEvidence === 'MODIFIED_KNEE'
    ) {
      candidate.modifiedVariantEvidenceMs += elapsed;
    }
    candidate.lastVariantFrameEvidence = frameEvidence;
    const confirmedModifiedMs = this.rules.lowerBodyVariantConfirmationMs;
    const lockedModifiedMs = confirmedModifiedMs * 2;
    if (
      frameEvidence === 'MODIFIED_KNEE' &&
      candidate.modifiedVariantEvidenceMs >= confirmedModifiedMs
    ) {
      candidate.eligibility = 'MODIFIED_KNEE';
    } else if (
      candidate.standardVariantEvidenceMs >= lockedModifiedMs &&
      candidate.modifiedVariantEvidenceMs < lockedModifiedMs
    ) {
      candidate.eligibility = 'STANDARD';
    } else if (candidate.eligibility !== 'MODIFIED_KNEE') {
      candidate.eligibility = 'PENDING_STANDARD';
    }
  }

  private feedback(
    phase: PushupPhaseV5,
    readiness: PushupReadinessV5Result,
    rejection: RejectedRepReason | undefined,
    rep: ExerciseRep | undefined,
  ): string {
    if (rep) return rep.qualityScore >= 90 ? 'PERFECT REP' : 'GOOD REP';
    if (rejection === 'MODIFIED_PUSHUP') return 'STRAIGHTEN YOUR LEGS';
    if (rejection) return rejection.replaceAll('_', ' ');
    if (readiness.state !== 'READY') return readiness.feedback;
    if (phase === 'NOT_READY') return 'HOLD TOP POSITION';
    if (phase === 'TOP' || phase === 'TOP_CONFIRMED') return 'DESCEND';
    if (phase === 'DESCENDING') return 'GO LOWER';
    if (phase === 'BOTTOM') return 'PUSH';
    return 'FULLY EXTEND';
  }

  private lineAngleFromHorizontal(
    start: PoseLandmark | undefined,
    end: PoseLandmark | undefined,
  ): number | undefined {
    if (!start || !end) return undefined;
    const x = Math.abs(end.x - start.x);
    const y = Math.abs(end.y - start.y);
    if (x + y === 0) return undefined;
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  private resetRuntime(): void {
    this.motion.reset();
    this.previousAngle = null;
    this.accumulator = null;
    this.readinessLostAt = null;
  }
}
