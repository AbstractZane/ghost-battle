import type { ExerciseDetector } from '@/exercises/ExerciseDetector';
import { PushupVariantClassifier } from '../PushupVariantClassifier';
import { LAB_V6_FORM_RULES, type PushupRules } from '../pushupRules';
import type { ExerciseDetectionResult, RejectedRepReason } from '../pushupTypes';
import { PushupDetectorV6 } from '../v6/PushupDetectorV6';
import type { PoseResult } from '@/pose/poseTypes';
import { hasFrontViewPlankSupport } from '../frontViewPlank';

/** Lab-only conservative contrast: arm readiness stays permissive, but a completed
 * rep needs fresh, temporally corroborated straight-leg evidence. Occlusion can
 * therefore produce false negatives. Never substitutes for the production V6. */
export class PositiveLegPushupDetector implements ExerciseDetector {
  private motion: PushupDetectorV6;
  private variant = new PushupVariantClassifier();
  private count = 0;
  private lastTimestamp: number | null = null;
  private candidateStarted = false;
  private standardSince: number | null = null;
  private standardConfirmed = false;
  private lastRejection: RejectedRepReason | undefined;

  constructor(private readonly rules: Readonly<PushupRules> = LAB_V6_FORM_RULES) {
    this.motion = new PushupDetectorV6({ ...rules });
  }

  getPostureDiagnostics() {
    return {
      ...this.motion.getPostureDiagnostics(),
      standardConfirmed: this.standardConfirmed,
      standardSince: this.standardSince,
    };
  }

  private clearCandidate() {
    this.candidateStarted = false;
    this.standardSince = null;
    this.standardConfirmed = false;
  }

  setPaused(paused: boolean) {
    this.motion.setPaused(paused);
    this.variant.reset();
    this.clearCandidate();
  }

  reset() {
    this.motion.reset();
    this.variant.reset();
    this.clearCandidate();
    this.count = 0;
    this.lastTimestamp = null;
    this.lastRejection = undefined;
  }

  processPose(pose: PoseResult, timestamp = pose.timestamp): ExerciseDetectionResult {
    if (
      !Number.isFinite(timestamp) ||
      (this.lastTimestamp !== null && timestamp <= this.lastTimestamp)
    ) {
      return {
        ...this.motion.processPose(pose, timestamp),
        totalReps: this.count,
        repCompleted: false,
        rep: undefined,
      };
    }
    if (
      this.lastTimestamp !== null &&
      timestamp - this.lastTimestamp > this.rules.v6TrackingGraceMs
    ) {
      this.variant.reset();
      this.clearCandidate();
    }
    this.lastTimestamp = timestamp;
    const observedLandmarks = { ...pose.landmarks };
    for (const name of [
      'leftShoulder',
      'leftHip',
      'leftKnee',
      'leftAnkle',
      'rightShoulder',
      'rightHip',
      'rightKnee',
      'rightAnkle',
    ] as const) {
      const landmark = pose.landmarks[name];
      if (!landmark) continue;
      const confidence = Math.min(
        landmark.confidence,
        pose.rawLandmarks?.[name]?.confidence ?? landmark.confidence,
      );
      observedLandmarks[name] = {
        ...landmark,
        confidence: Number.isFinite(confidence) ? confidence : 0,
      };
    }
    const tracking = pose.tracking
      ? {
          ...pose.tracking,
          freshLandmarks: pose.tracking.freshLandmarks.filter(
            (name) =>
              !pose.tracking?.predictedLandmarks?.includes(name) &&
              !pose.tracking?.rejectedLandmarks?.includes(name),
          ),
        }
      : undefined;
    const variant = this.variant.update(
      { ...pose, landmarks: observedLandmarks, tracking },
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
      hasFrontViewPlankSupport(pose, 'left', this.rules) ||
        hasFrontViewPlankSupport(pose, 'right', this.rules),
    );
    const result = this.motion.processPose(pose, timestamp);
    if (result.metrics.candidateActive && !this.candidateStarted) {
      this.clearCandidate();
      this.candidateStarted = true;
    }
    if (this.candidateStarted) {
      if (variant.frameEvidence === 'STANDARD') {
        this.standardSince ??= timestamp;
        this.standardConfirmed ||=
          timestamp - this.standardSince >= this.rules.lowerBodyVariantConfirmationMs;
      } else this.standardSince = null;
    }
    let rejectedReason = result.rejectedReason;
    let accepted = false;
    if (result.repCompleted) {
      accepted =
        this.standardConfirmed &&
        variant.variant === 'STANDARD' &&
        variant.frameEvidence === 'STANDARD';
      if (accepted) this.count += 1;
      else
        rejectedReason =
          variant.frameEvidence === 'MODIFIED_KNEE' || variant.variant === 'MODIFIED_KNEE'
            ? 'MODIFIED_PUSHUP'
            : 'VARIANT_UNCONFIRMED';
    }
    if (rejectedReason) this.lastRejection = rejectedReason;
    const eligibility = this.standardConfirmed ? 'STANDARD' : 'PENDING_STANDARD';
    if (!result.metrics.candidateActive || result.repCompleted) this.clearCandidate();
    return {
      ...result,
      repCompleted: accepted,
      totalReps: this.count,
      qualityScore: accepted ? result.qualityScore : undefined,
      rep: accepted && result.rep ? { ...result.rep, index: this.count } : undefined,
      rejectedReason,
      feedback:
        rejectedReason === 'VARIANT_UNCONFIRMED'
          ? 'STRAIGHT LEGS NOT CONFIRMED'
          : rejectedReason === 'MODIFIED_PUSHUP'
            ? 'KNEE SUPPORT DETECTED'
            : result.feedback,
      metrics: {
        ...result.metrics,
        exerciseVariant: variant.variant,
        variantFrameEvidence: variant.frameEvidence,
        variantConfidence: variant.confidence,
        kneeAngle: variant.kneeAngle,
        legChainAngle: variant.legChainAngle,
        ankleExtensionRatio: variant.ankleExtensionRatio,
        candidateEligibility: result.metrics.candidateActive
          ? eligibility
          : result.metrics.candidateEligibility,
        lastRejectionReason: this.lastRejection,
        transitionAccepted: accepted || (!result.repCompleted && result.metrics.transitionAccepted),
      },
    };
  }
}
