import type { ExerciseDetector } from '@/exercises/ExerciseDetector';
import { calculateAngle, landmarkDistance } from '@/pose/poseMath';
import { landmarksForSide, StableSideSelector } from '@/pose/sideSelector';
import type { PoseLandmarks, PoseResult, PoseSide } from '@/pose/poseTypes';
import type { ExerciseRep } from '@/types/models';

import { PushupContextDetector } from './PushupContextDetector';
import { getPushupFeedback, qualityLabel } from './pushupFeedback';
import { analyzePushupForm } from './PushupFormAnalyzer';
import { PushupMotionStateMachine, type PushupMotionUpdate } from './PushupMotionStateMachine';
import { DEFAULT_PUSHUP_RULES, type PushupRules } from './pushupRules';
import { PushupVariantClassifier } from './PushupVariantClassifier';
import { hasFrontViewPlankSupport } from './frontViewPlank';
import type {
  ExerciseDetectionResult,
  PushupArmState,
  PushupCandidateEligibility,
  PushupDebugEvent,
  PushupElbowSource,
  PushupMetrics,
  RejectedRepReason,
} from './pushupTypes';

interface RepAccumulator {
  startedAt: number;
  downAt?: number;
  minimumElbowAngle: number;
  maximumElbowAngle: number;
  bodyAngleSum: number;
  bodySamples: number;
  confidenceSum: number;
  samples: number;
  severeAlignmentViolation: boolean;
  eligibility: PushupCandidateEligibility;
  frontViewEligible: boolean;
}

type TimedAngle = { angle: number; timestamp: number };

export class PushupDetector implements ExerciseDetector {
  private armState: PushupArmState = 'DISARMED';
  private armingSince: number | null = null;
  private totalReps = 0;
  private paused = false;
  private accumulator: RepAccumulator | null = null;
  private readonly previousElbows: Partial<Record<PushupElbowSource, TimedAngle>> = {};
  private readonly sideSelector = new StableSideSelector();
  private readonly contextDetector: PushupContextDetector;
  private readonly variantClassifier = new PushupVariantClassifier();
  private readonly motion: PushupMotionStateMachine;
  private readonly debugEvents: PushupDebugEvent[] = [];
  private lastRejectionReason?: RejectedRepReason;
  private lastPoseTimestamp?: number;
  private lastDetectionResult?: ExerciseDetectionResult;

  constructor(private rules: PushupRules = { ...DEFAULT_PUSHUP_RULES }) {
    this.contextDetector = new PushupContextDetector({
      enterConfirmationMs: rules.contextEntryConfirmationMs,
      degradedGraceMs: rules.trackingGraceMs,
      exitConfirmationMs: rules.contextExitConfirmationMs,
    });
    this.motion = new PushupMotionStateMachine(rules);
  }

  setRules(rules: Partial<PushupRules>): void {
    this.rules = { ...this.rules, ...rules };
    this.contextDetector.setOptions({
      enterConfirmationMs: this.rules.contextEntryConfirmationMs,
      degradedGraceMs: this.rules.trackingGraceMs,
      exitConfirmationMs: this.rules.contextExitConfirmationMs,
    });
    this.motion.setRules(this.rules);
  }

  getRules(): Readonly<PushupRules> {
    return this.rules;
  }

  getDebugEvents(): ReadonlyArray<PushupDebugEvent> {
    return this.debugEvents;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.disarm();
  }

  reset(): void {
    this.armState = 'DISARMED';
    this.armingSince = null;
    this.totalReps = 0;
    this.paused = false;
    this.accumulator = null;
    this.clearElbowHistory();
    this.sideSelector.reset();
    this.contextDetector.reset();
    this.variantClassifier.reset();
    this.motion.reset();
    this.lastRejectionReason = undefined;
    this.debugEvents.length = 0;
    this.lastPoseTimestamp = undefined;
    this.lastDetectionResult = undefined;
  }

  processPose(pose: PoseResult, timestamp = pose.timestamp): ExerciseDetectionResult {
    // Missing inference results never reach this method. Expire the cycle before
    // a returning frame can join motion recorded before the camera interruption.
    const staleTimestamp =
      !Number.isFinite(timestamp) ||
      (this.lastPoseTimestamp !== undefined && timestamp <= this.lastPoseTimestamp);
    let interruptedCandidate = false;
    if (
      !staleTimestamp &&
      this.lastPoseTimestamp !== undefined &&
      timestamp - this.lastPoseTimestamp > this.rules.trackingGraceMs
    ) {
      interruptedCandidate = this.accumulator !== null;
      if (interruptedCandidate) this.lastRejectionReason = 'TRACKING_LOST';
      this.disarm();
      this.contextDetector.reset();
      this.variantClassifier.reset();
      this.sideSelector.reset();
    }
    if (staleTimestamp) {
      if (this.lastDetectionResult) {
        return { ...this.lastDetectionResult, repCompleted: false, rep: undefined };
      }
      // No accepted frame exists yet; an invalid timestamp cannot arm the detector.
      const selection = this.sideSelector.select(pose.landmarks, 0, {
        individualCoreFloor: this.rules.minimumCoreLandmarkConfidence,
        coreAggregate: this.rules.coreLandmarkConfidence,
        sustainedFailureMs: this.rules.sideSwitchFailureMs,
        emergencyFailureMs: this.rules.emergencySideFailoverMs,
      });
      this.sideSelector.reset();
      return this.result(
        this.calculateMetrics(pose.landmarks, selection.side, selection),
        false,
        'BODY NOT VISIBLE',
      );
    }
    this.lastPoseTimestamp = timestamp;
    this.lastDetectionResult = this.processFreshPose(pose, timestamp);
    if (interruptedCandidate) this.lastDetectionResult.rejectedReason = 'TRACKING_LOST';
    return this.lastDetectionResult;
  }

  private processFreshPose(pose: PoseResult, timestamp: number): ExerciseDetectionResult {
    const selection = this.sideSelector.select(pose.landmarks, timestamp, {
      individualCoreFloor: this.rules.minimumCoreLandmarkConfidence,
      coreAggregate: this.rules.coreLandmarkConfidence,
      sustainedFailureMs: this.rules.sideSwitchFailureMs,
      emergencyFailureMs: this.rules.emergencySideFailoverMs,
    });
    const metrics = this.calculateMetrics(pose.landmarks, selection.side, selection);
    metrics.frontViewPlankSupport = hasFrontViewPlankSupport(pose, selection.side, this.rules);
    const variant = this.variantClassifier.update(
      pose,
      timestamp,
      {
        landmarkConfidence: this.rules.lowerBodyLandmarkConfidence,
        standardMinimumKneeAngle: this.rules.standardMinimumKneeAngle,
        modifiedMaximumKneeAngle: this.rules.modifiedMaximumKneeAngle,
        minimumLegChainAngle: this.rules.minimumLegChainAngle,
        standardMinimumAnkleExtensionRatio: this.rules.standardMinimumAnkleExtensionRatio,
        modifiedMinimumAnkleDeviationRatio: this.rules.modifiedMinimumAnkleDeviationRatio,
        confirmationMs: this.rules.lowerBodyVariantConfirmationMs,
        trackingGraceMs: this.rules.trackingGraceMs,
        supportingAnkleConfidence: this.rules.v6SupportingAnkleConfidence,
      },
      metrics.frontViewPlankSupport,
    );
    Object.assign(metrics, {
      exerciseVariant: variant.variant,
      variantFrameEvidence: variant.frameEvidence,
      variantSide: variant.side,
      variantConfidence: variant.confidence,
      kneeAngle: variant.kneeAngle ?? metrics.kneeAngle,
      legChainAngle: variant.legChainAngle,
      ankleExtensionRatio: variant.ankleExtensionRatio,
      ankleDeviationRatio: variant.ankleDeviationRatio,
    });

    metrics.signalQuality =
      pose.tracking?.signalQuality ?? (metrics.armSignalReliable ? 'GOOD' : 'LOST');
    metrics.elbowVelocity = this.updateElbowVelocity(metrics, timestamp);
    if (this.paused) return this.result(metrics, false, 'PAUSED');

    const contextReliable = this.hasReliableContextSignal(metrics);
    const contextFresh = contextReliable && this.hasFreshContextSignal(pose, metrics);
    const plausible = contextReliable && this.hasPlausiblePushupContext(metrics);
    const contextState = this.contextDetector.update(plausible, contextFresh, timestamp);
    metrics.contextState = contextState;

    if (contextState === 'NOT_PUSHUP' || contextState === 'EXITING_PUSHUP') {
      return this.handleContextLoss(
        metrics,
        contextReliable ? 'MOVE INTO A PLANK POSITION' : 'BODY NOT VISIBLE',
      );
    }

    const freshArm = this.hasFreshArmSignal(pose, metrics.elbowSource);
    if (this.armState !== 'ARMED') {
      return this.handleArming(metrics, timestamp, contextFresh, freshArm);
    }

    const canTrackMotion =
      metrics.armSignalReliable &&
      metrics.elbowAngle !== undefined &&
      metrics.signalQuality !== 'LOST' &&
      (contextState === 'PUSHUP' || contextState === 'UNCERTAIN');
    let motion = this.motion.getSnapshot();
    if (canTrackMotion) {
      motion = this.motion.update({
        timestamp,
        elbowAngle: metrics.elbowAngle as number,
        elbowVelocity: metrics.elbowVelocity,
        reliable: true,
      });
    }

    let rep: ExerciseRep | undefined;
    let rejectedReason: RejectedRepReason | undefined;
    let completedEligibility: PushupCandidateEligibility | undefined;
    if (motion.candidateStarted) this.startCandidate(metrics, timestamp, contextReliable);
    else if (this.accumulator && canTrackMotion) this.updateAccumulator(metrics, contextReliable);
    this.updateCandidateEligibility(metrics.exerciseVariant);
    if (motion.phase === 'DOWN' && this.accumulator && motion.bottomConfirmed) {
      this.accumulator.downAt ??= timestamp;
    }
    if (motion.candidateCancelled) this.accumulator = null;
    if (motion.candidateCompleted) {
      completedEligibility = this.accumulator?.eligibility;
      ({ rep, rejectedReason } = this.completeRep(timestamp));
      if (rejectedReason) this.lastRejectionReason = rejectedReason;
    }

    this.applyMotionDiagnostics(metrics, motion);
    if (completedEligibility) metrics.candidateEligibility = completedEligibility;
    const repCompleted = rep !== undefined;
    const feedback = this.feedbackFor(metrics, rep, rejectedReason, canTrackMotion);
    this.logDebug(timestamp, metrics, motion, repCompleted, rejectedReason);
    return this.result(metrics, repCompleted, feedback, rep, rejectedReason);
  }

  private handleArming(
    metrics: PushupMetrics,
    timestamp: number,
    contextFresh: boolean,
    freshArm: boolean,
  ): ExerciseDetectionResult {
    const strictEntry =
      metrics.contextState === 'PUSHUP' &&
      contextFresh &&
      freshArm &&
      metrics.armSignalReliable &&
      metrics.signalQuality === 'GOOD' &&
      (metrics.exerciseVariant === 'STANDARD' ||
        (metrics.frontViewPlankSupport === true && metrics.exerciseVariant === 'UNKNOWN'));
    const elbowAngle = metrics.elbowAngle;
    const canPrearm =
      metrics.contextState === 'ENTERING_PUSHUP' &&
      contextFresh &&
      freshArm &&
      metrics.armSignalReliable &&
      metrics.signalQuality === 'GOOD' &&
      elbowAngle !== undefined &&
      elbowAngle >= this.rules.upElbowAngle;
    if (canPrearm) {
      if (this.armState === 'DISARMED') {
        this.armState = 'ARMING';
        this.armingSince = timestamp;
      }
      return this.result(metrics, false, 'HOLD TOP POSITION');
    }
    if (!strictEntry || elbowAngle === undefined) {
      if (metrics.contextState !== 'PUSHUP') {
        this.armState = 'DISARMED';
        this.armingSince = null;
      }
      const feedback =
        metrics.exerciseVariant === 'MODIFIED_KNEE'
          ? 'STRAIGHTEN YOUR LEGS'
          : metrics.contextState === 'ENTERING_PUSHUP'
            ? 'HOLD TOP POSITION'
            : 'HOLD A CLEAR TOP POSITION';
      return this.result(metrics, false, feedback);
    }
    if (elbowAngle < this.rules.upElbowAngle) {
      this.armState = 'DISARMED';
      this.armingSince = null;
      return this.result(metrics, false, 'MOVE INTO TOP POSITION');
    }
    if (this.armState === 'DISARMED') {
      this.armState = 'ARMING';
      this.armingSince = timestamp;
    }
    if (timestamp - (this.armingSince ?? timestamp) < this.rules.armingConfirmationMs) {
      return this.result(metrics, false, 'HOLD TOP POSITION');
    }
    this.armState = 'ARMED';
    this.armingSince = null;
    this.motion.armAtTop(elbowAngle, timestamp);
    this.applyMotionDiagnostics(metrics, this.motion.getSnapshot());
    return this.result(metrics, false, 'READY');
  }

  private calculateMetrics(
    landmarks: PoseLandmarks,
    side: PoseSide,
    selection: ReturnType<StableSideSelector['select']>,
  ): PushupMetrics {
    const names = landmarksForSide(side);
    const selectedConfidence = side === 'left' ? selection.left : selection.right;
    const leftNames = landmarksForSide('left');
    const rightNames = landmarksForSide('right');
    const leftElbowAngle =
      calculateAngle(
        landmarks[leftNames.shoulder],
        landmarks[leftNames.elbow],
        landmarks[leftNames.wrist],
      ) ?? undefined;
    const rightElbowAngle =
      calculateAngle(
        landmarks[rightNames.shoulder],
        landmarks[rightNames.elbow],
        landmarks[rightNames.wrist],
      ) ?? undefined;
    const leftArmConfidence = this.armConfidence(selection.left.landmarks);
    const rightArmConfidence = this.armConfidence(selection.right.landmarks);
    const leftArmUsable = this.armUsable(
      leftElbowAngle,
      selection.left.landmarks,
      leftArmConfidence,
    );
    const rightArmUsable = this.armUsable(
      rightElbowAngle,
      selection.right.landmarks,
      rightArmConfidence,
    );
    let elbowAngle: number | undefined;
    let elbowSource: PushupElbowSource | undefined;
    let armConfidence = 0;
    if (leftArmUsable && rightArmUsable) {
      const total = leftArmConfidence + rightArmConfidence;
      elbowAngle =
        ((leftElbowAngle as number) * leftArmConfidence +
          (rightElbowAngle as number) * rightArmConfidence) /
        total;
      elbowSource = 'fused';
      armConfidence = total / 2;
    } else if (side === 'left' ? leftArmUsable : rightArmUsable) {
      elbowAngle = side === 'left' ? leftElbowAngle : rightElbowAngle;
      elbowSource = side;
      armConfidence = side === 'left' ? leftArmConfidence : rightArmConfidence;
    } else if (side === 'left' ? rightArmUsable : leftArmUsable) {
      elbowAngle = side === 'left' ? rightElbowAngle : leftElbowAngle;
      elbowSource = side === 'left' ? 'right' : 'left';
      armConfidence = side === 'left' ? rightArmConfidence : leftArmConfidence;
    }

    const ankleUsable =
      selectedConfidence.landmarks.ankle >= this.rules.supportingLandmarkConfidence;
    const kneeUsable = selectedConfidence.landmarks.knee >= this.rules.supportingLandmarkConfidence;
    const bodyAlignmentSource = ankleUsable ? 'ankle' : kneeUsable ? 'knee' : 'unavailable';
    const bodyEndpoint =
      bodyAlignmentSource === 'ankle'
        ? landmarks[names.ankle]
        : bodyAlignmentSource === 'knee'
          ? landmarks[names.knee]
          : undefined;
    const motion = this.motion.getSnapshot();
    return {
      elbowAngle,
      leftElbowAngle,
      rightElbowAngle,
      elbowSource,
      armSignalReliable: elbowAngle !== undefined,
      bodyAngle:
        calculateAngle(landmarks[names.shoulder], landmarks[names.hip], bodyEndpoint) ?? undefined,
      kneeAngle:
        calculateAngle(landmarks[names.hip], landmarks[names.knee], landmarks[names.ankle]) ??
        undefined,
      confidence: armConfidence,
      selectedSide: side,
      leftVisibility: selection.leftScore,
      rightVisibility: selection.rightScore,
      leftCoreConfidence: selection.left.coreScore,
      rightCoreConfidence: selection.right.coreScore,
      leftLandmarks: selection.left.landmarks,
      rightLandmarks: selection.right.landmarks,
      coreConfidence: selectedConfidence.coreScore,
      supportingConfidence: selectedConfidence.supportingScore,
      sideSelectionReason: selection.reason,
      sideSelectionAlternativeBetterMs: selection.alternativeBetterMs,
      bodyAlignmentSource,
      torsoAngleFromHorizontal: this.lineAngleFromHorizontal(
        landmarks[names.shoulder],
        landmarks[names.hip],
      ),
      bodySpan: landmarkDistance(landmarks[names.shoulder], bodyEndpoint) ?? undefined,
      exerciseVariant: 'UNKNOWN',
      variantFrameEvidence: 'UNKNOWN',
      armState: this.armState,
      contextState: this.contextDetector.getState(),
      signalQuality: 'GOOD',
      motionPhase: motion.phase,
      recentPeakAngle: motion.recentPeakAngle,
      recentPeakTimestamp: motion.recentPeakTimestamp,
      candidateActive: motion.candidateActive,
      candidateEligibility: this.accumulator?.eligibility ?? 'INACTIVE',
      requestedTransition: motion.requestedTransition,
      transitionAccepted: motion.transitionAccepted,
      lastRejectionReason: this.lastRejectionReason,
    };
  }

  private armConfidence(values: PushupMetrics['leftLandmarks']): number {
    return (values.shoulder + values.elbow + values.wrist) / 3;
  }

  private armUsable(
    angle: number | undefined,
    values: PushupMetrics['leftLandmarks'],
    confidence: number,
  ): boolean {
    return (
      angle !== undefined &&
      confidence >= this.rules.coreLandmarkConfidence &&
      [values.shoulder, values.elbow, values.wrist].every(
        (value) => value >= this.rules.minimumCoreLandmarkConfidence,
      )
    );
  }

  private hasReliableContextSignal(metrics: PushupMetrics): boolean {
    const selected =
      metrics.selectedSide === 'left' ? metrics.leftLandmarks : metrics.rightLandmarks;
    return (
      metrics.bodyAngle !== undefined &&
      selected.shoulder >= this.rules.minimumCoreLandmarkConfidence &&
      selected.hip >= this.rules.minimumCoreLandmarkConfidence &&
      metrics.bodyAlignmentSource !== 'unavailable'
    );
  }

  private hasPlausiblePushupContext(metrics: PushupMetrics): boolean {
    return (
      metrics.bodyAngle !== undefined &&
      metrics.bodyAngle >= this.rules.severeBodyAngle &&
      metrics.torsoAngleFromHorizontal !== undefined &&
      (metrics.torsoAngleFromHorizontal <= this.rules.maximumPlankTorsoAngle ||
        metrics.frontViewPlankSupport === true) &&
      metrics.bodySpan !== undefined &&
      metrics.bodySpan >= this.rules.minimumPlankBodySpan
    );
  }

  private hasFreshContextSignal(pose: PoseResult, metrics: PushupMetrics): boolean {
    if (!pose.tracking) return true;
    if (pose.tracking.signalQuality === 'LOST') return false;
    const fresh = new Set(pose.tracking.freshLandmarks);
    const names = landmarksForSide(metrics.selectedSide);
    const endpoint = metrics.bodyAlignmentSource === 'ankle' ? names.ankle : names.knee;
    return [names.shoulder, names.hip, endpoint].every((name) => fresh.has(name));
  }

  private hasFreshArmSignal(pose: PoseResult, source?: PushupElbowSource): boolean {
    if (!source || pose.tracking?.signalQuality === 'LOST') return false;
    if (!pose.tracking) return true;
    const fresh = new Set(pose.tracking.freshLandmarks);
    const sideFresh = (side: PoseSide) => {
      const names = landmarksForSide(side);
      return [names.shoulder, names.elbow, names.wrist].every((name) => fresh.has(name));
    };
    return source === 'fused' ? sideFresh('left') || sideFresh('right') : sideFresh(source);
  }

  private startCandidate(
    metrics: PushupMetrics,
    timestamp: number,
    contextReliable: boolean,
  ): void {
    const elbowAngle = metrics.elbowAngle as number;
    const bodyAngle = contextReliable ? metrics.bodyAngle : undefined;
    this.accumulator = {
      startedAt: timestamp,
      minimumElbowAngle: elbowAngle,
      maximumElbowAngle: elbowAngle,
      bodyAngleSum: bodyAngle ?? 0,
      bodySamples: bodyAngle === undefined ? 0 : 1,
      confidenceSum: metrics.confidence ?? 0,
      samples: 1,
      severeAlignmentViolation: bodyAngle !== undefined && bodyAngle < this.rules.severeBodyAngle,
      frontViewEligible: metrics.frontViewPlankSupport === true,
      eligibility:
        metrics.exerciseVariant === 'STANDARD'
          ? 'STANDARD'
          : metrics.exerciseVariant === 'MODIFIED_KNEE'
            ? 'MODIFIED_KNEE'
            : 'PENDING_STANDARD',
    };
  }

  private updateAccumulator(metrics: PushupMetrics, contextReliable: boolean): void {
    const data = this.accumulator;
    if (!data || metrics.elbowAngle === undefined) return;
    data.minimumElbowAngle = Math.min(data.minimumElbowAngle, metrics.elbowAngle);
    data.maximumElbowAngle = Math.max(data.maximumElbowAngle, metrics.elbowAngle);
    if (contextReliable && metrics.bodyAngle !== undefined) {
      data.bodyAngleSum += metrics.bodyAngle;
      data.bodySamples += 1;
      data.severeAlignmentViolation ||= metrics.bodyAngle < this.rules.severeBodyAngle;
    }
    data.confidenceSum += metrics.confidence ?? 0;
    data.samples += 1;
  }

  private updateCandidateEligibility(variant: PushupMetrics['exerciseVariant']): void {
    const data = this.accumulator;
    if (!data || data.eligibility === 'MODIFIED_KNEE') return;
    if (variant === 'MODIFIED_KNEE') data.eligibility = 'MODIFIED_KNEE';
    else if (variant === 'STANDARD') data.eligibility = 'STANDARD';
    else if (data.eligibility === 'STANDARD') data.eligibility = 'PENDING_STANDARD';
  }

  private completeRep(timestamp: number): {
    rep?: ExerciseRep;
    rejectedReason?: RejectedRepReason;
  } {
    const data = this.accumulator;
    this.accumulator = null;
    if (!data?.downAt) return { rejectedReason: 'INSUFFICIENT_DEPTH' };
    if (data.eligibility === 'MODIFIED_KNEE') return { rejectedReason: 'MODIFIED_PUSHUP' };
    if (data.eligibility !== 'STANDARD' && !data.frontViewEligible)
      return { rejectedReason: 'VARIANT_UNCONFIRMED' };
    const durationMs = timestamp - data.startedAt;
    if (durationMs < this.rules.minimumRepDurationMs)
      return { rejectedReason: 'MOVEMENT_TOO_FAST' };
    if (data.severeAlignmentViolation || data.bodySamples === 0)
      return { rejectedReason: 'BODY_ALIGNMENT' };
    const averageBodyAngle = data.bodyAngleSum / data.bodySamples;
    const averageConfidenceValue = data.confidenceSum / data.samples;
    const form = analyzePushupForm({
      minimumElbowAngle: data.minimumElbowAngle,
      maximumElbowAngle: data.maximumElbowAngle,
      averageBodyAngle,
      averageConfidence: averageConfidenceValue,
      durationMs,
    });
    this.totalReps += 1;
    return {
      rep: {
        index: this.totalReps,
        timestamp,
        durationMs,
        minimumElbowAngle: Math.round(data.minimumElbowAngle),
        maximumElbowAngle: Math.round(data.maximumElbowAngle),
        averageBodyAngle: Math.round(averageBodyAngle),
        qualityScore: form.qualityScore,
        grade: form.grade,
      },
    };
  }

  private feedbackFor(
    metrics: PushupMetrics,
    rep: ExerciseRep | undefined,
    rejectedReason: RejectedRepReason | undefined,
    canTrackMotion: boolean,
  ): string {
    if (rep) return qualityLabel(rep.qualityScore);
    if (metrics.exerciseVariant === 'MODIFIED_KNEE' || rejectedReason === 'MODIFIED_PUSHUP')
      return 'STRAIGHTEN YOUR LEGS';
    if (!canTrackMotion) return 'HOLD POSITION';
    return getPushupFeedback(
      this.motion.getSnapshot().phase,
      metrics.elbowAngle as number,
      metrics.bodyAngle ?? this.rules.idealBodyAngle,
      this.rules.minimumBodyAngle,
    );
  }

  private updateElbowVelocity(metrics: PushupMetrics, timestamp: number): number | undefined {
    const values: Partial<Record<PushupElbowSource, number>> = {
      left: metrics.leftElbowAngle,
      right: metrics.rightElbowAngle,
      fused: metrics.elbowSource === 'fused' ? metrics.elbowAngle : undefined,
    };
    let selectedVelocity: number | undefined;
    for (const source of ['left', 'right', 'fused'] as const) {
      const angle = values[source];
      if (angle === undefined) continue;
      const previous = this.previousElbows[source];
      this.previousElbows[source] = { angle, timestamp };
      if (
        source === metrics.elbowSource &&
        previous &&
        timestamp > previous.timestamp &&
        timestamp - previous.timestamp <= this.rules.trackingGraceMs
      ) {
        selectedVelocity = ((angle - previous.angle) * 1000) / (timestamp - previous.timestamp);
      }
    }
    return selectedVelocity;
  }

  private applyMotionDiagnostics(metrics: PushupMetrics, motion: PushupMotionUpdate): void {
    metrics.motionPhase = motion.phase;
    metrics.recentPeakAngle = motion.recentPeakAngle;
    metrics.recentPeakTimestamp = motion.recentPeakTimestamp;
    metrics.candidateActive = motion.candidateActive;
    metrics.candidateEligibility = this.accumulator?.eligibility ?? 'INACTIVE';
    metrics.requestedTransition = motion.requestedTransition;
    metrics.transitionAccepted = motion.transitionAccepted;
    metrics.lastRejectionReason = this.lastRejectionReason;
  }

  private handleContextLoss(metrics: PushupMetrics, feedback: string): ExerciseDetectionResult {
    const rejectedReason = this.accumulator ? 'TRACKING_LOST' : undefined;
    if (rejectedReason) this.lastRejectionReason = rejectedReason;
    this.disarm();
    metrics.lastRejectionReason = this.lastRejectionReason;
    return this.result(metrics, false, feedback, undefined, rejectedReason);
  }

  private lineAngleFromHorizontal(
    start: PoseLandmarks[keyof PoseLandmarks],
    end: PoseLandmarks[keyof PoseLandmarks],
  ): number | undefined {
    if (!start || !end) return undefined;
    const deltaX = Math.abs(end.x - start.x);
    const deltaY = Math.abs(end.y - start.y);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || deltaX + deltaY === 0)
      return undefined;
    return (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
  }

  private disarm(): void {
    this.armState = 'DISARMED';
    this.armingSince = null;
    this.accumulator = null;
    this.motion.reset();
    this.clearElbowHistory();
  }

  private clearElbowHistory(): void {
    delete this.previousElbows.left;
    delete this.previousElbows.right;
    delete this.previousElbows.fused;
  }

  private result(
    metrics: PushupMetrics,
    repCompleted: boolean,
    feedback: string,
    rep?: ExerciseRep,
    rejectedReason?: RejectedRepReason,
  ): ExerciseDetectionResult {
    const motion = this.motion.getSnapshot();
    metrics.armState = this.armState;
    metrics.motionPhase = motion.phase;
    metrics.candidateActive = motion.candidateActive;
    return {
      state: motion.phase,
      repCompleted,
      totalReps: this.totalReps,
      qualityScore: rep?.qualityScore,
      feedback,
      metrics,
      rep,
      rejectedReason,
    };
  }

  private logDebug(
    timestamp: number,
    metrics: PushupMetrics,
    motion: PushupMotionUpdate,
    accepted: boolean,
    rejectedReason: RejectedRepReason | undefined,
  ): void {
    this.debugEvents.push({
      timestamp,
      elbowAngle: metrics.elbowAngle,
      bodyAngle: metrics.bodyAngle,
      confidence: metrics.confidence,
      selectedSide: metrics.selectedSide,
      elbowSource: metrics.elbowSource,
      currentState: motion.phase,
      nextState: motion.requestedTransition,
      reasonForTransition: motion.transitionAccepted
        ? `stable ${motion.requestedTransition ?? motion.phase}`
        : undefined,
      repAccepted: accepted,
      repRejected: rejectedReason !== undefined,
      rejectionReason: rejectedReason,
      candidateEligibility: metrics.candidateEligibility,
      recentPeakAngle: motion.recentPeakAngle,
      recentPeakTimestamp: motion.recentPeakTimestamp,
    });
    if (this.debugEvents.length > 200) this.debugEvents.shift();
  }
}
