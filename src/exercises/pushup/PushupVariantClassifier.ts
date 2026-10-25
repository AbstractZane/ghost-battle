import { calculateAngle } from '@/pose/poseMath';
import { landmarksForSide } from '@/pose/sideSelector';
import type { PoseResult, PoseSide } from '@/pose/poseTypes';

export type PushupExerciseVariant = 'STANDARD' | 'MODIFIED_KNEE' | 'UNKNOWN';

export interface PushupVariantThresholds {
  landmarkConfidence: number;
  standardMinimumKneeAngle: number;
  modifiedMaximumKneeAngle: number;
  minimumLegChainAngle: number;
  standardMinimumAnkleExtensionRatio: number;
  modifiedMinimumAnkleDeviationRatio: number;
  confirmationMs: number;
  trackingGraceMs: number;
  supportingAnkleConfidence?: number;
}

export interface PushupVariantSnapshot {
  variant: PushupExerciseVariant;
  frameEvidence: PushupExerciseVariant;
  side?: PoseSide;
  confidence?: number;
  kneeAngle?: number;
  legChainAngle?: number;
  ankleExtensionRatio?: number;
  ankleDeviationRatio?: number;
}

interface SideEvidence extends Omit<PushupVariantSnapshot, 'variant'> {
  side: PoseSide;
  confidence: number;
  credible: boolean;
}

const COMPARABLE_SIDE_CONFIDENCE = 0.1;

/**
 * Separates lower-body support evidence from arm motion. The classifier deliberately returns
 * UNKNOWN for ambiguous geometry and uses time before accepting either standard or modified form.
 */
export class PushupVariantClassifier {
  private variant: PushupExerciseVariant = 'UNKNOWN';
  private candidate: Exclude<PushupExerciseVariant, 'UNKNOWN'> | null = null;
  private candidateSince = 0;
  private lastCredibleAt = 0;

  reset(): void {
    this.variant = 'UNKNOWN';
    this.candidate = null;
    this.candidateSince = 0;
    this.lastCredibleAt = 0;
  }

  update(
    pose: PoseResult,
    timestamp: number,
    thresholds: PushupVariantThresholds,
    frontViewSupport = false,
  ): PushupVariantSnapshot {
    const evidence = this.selectEvidence(pose, thresholds, frontViewSupport);
    const observed = evidence.frameEvidence;

    if (observed === 'UNKNOWN') {
      this.candidate = null;
      if (
        this.variant !== 'UNKNOWN' &&
        timestamp - this.lastCredibleAt > thresholds.trackingGraceMs
      ) {
        this.variant = 'UNKNOWN';
      }
      return { ...evidence, variant: this.variant };
    }

    if (observed === this.variant) {
      this.candidate = null;
      this.lastCredibleAt = timestamp;
      return { ...evidence, variant: this.variant };
    }

    if (this.candidate !== observed) {
      this.candidate = observed;
      this.candidateSince = timestamp;
    } else if (timestamp - this.candidateSince >= thresholds.confirmationMs) {
      this.variant = observed;
      this.candidate = null;
      this.lastCredibleAt = timestamp;
    }

    return { ...evidence, variant: this.variant };
  }

  private selectEvidence(
    pose: PoseResult,
    thresholds: PushupVariantThresholds,
    frontViewSupport: boolean,
  ): Omit<PushupVariantSnapshot, 'variant'> {
    const evidence = (['left', 'right'] as const).map((side) =>
      this.evaluateSide(pose, side, thresholds, frontViewSupport),
    );
    const credible = evidence.filter((item) => item.credible);
    if (credible.length === 0) return { frameEvidence: 'UNKNOWN' };

    // A projected leg can look bent from one side while the other still has
    // credible extended-leg evidence. Treat that disagreement as ambiguous;
    // choosing MODIFIED_KNEE merely because it is present made the result
    // depend on the incidental side selected by a 2D camera view.
    const hasStandardEvidence = credible.some((item) => item.frameEvidence === 'STANDARD');
    const hasModifiedEvidence = credible.some((item) => item.frameEvidence === 'MODIFIED_KNEE');
    if (hasStandardEvidence && hasModifiedEvidence) return { frameEvidence: 'UNKNOWN' };

    const strongestConfidence = Math.max(...credible.map((item) => item.confidence));
    const comparable = credible.filter(
      (item) => strongestConfidence - item.confidence <= COMPARABLE_SIDE_CONFIDENCE,
    );
    const chosen =
      comparable
        .filter((item) => item.frameEvidence === 'STANDARD')
        .sort((left, right) => right.confidence - left.confidence)[0] ??
      comparable
        .filter((item) => item.frameEvidence === 'MODIFIED_KNEE')
        .sort((left, right) => right.confidence - left.confidence)[0] ??
      comparable.sort((left, right) => right.confidence - left.confidence)[0];

    if (!chosen) return { frameEvidence: 'UNKNOWN' };
    return {
      frameEvidence: chosen.frameEvidence,
      side: chosen.side,
      confidence: chosen.confidence,
      kneeAngle: chosen.kneeAngle,
      legChainAngle: chosen.legChainAngle,
      ankleExtensionRatio: chosen.ankleExtensionRatio,
      ankleDeviationRatio: chosen.ankleDeviationRatio,
    };
  }

  private evaluateSide(
    pose: PoseResult,
    side: PoseSide,
    thresholds: PushupVariantThresholds,
    frontViewSupport: boolean,
  ): SideEvidence {
    const names = landmarksForSide(side);
    const shoulder = pose.landmarks[names.shoulder];
    const hip = pose.landmarks[names.hip];
    const knee = pose.landmarks[names.knee];
    const ankle = pose.landmarks[names.ankle];
    const confidence = Math.min(
      shoulder?.confidence ?? 0,
      hip?.confidence ?? 0,
      knee?.confidence ?? 0,
      ankle?.confidence ?? 0,
    );
    const fresh = pose.tracking
      ? pose.tracking.signalQuality !== 'LOST' &&
        [names.shoulder, names.hip, names.knee, names.ankle].every((name) =>
          pose.tracking?.freshLandmarks.includes(name),
        )
      : true;
    if (
      !fresh ||
      Math.min(shoulder?.confidence ?? 0, hip?.confidence ?? 0, knee?.confidence ?? 0) <
        thresholds.landmarkConfidence ||
      (ankle?.confidence ?? 0) <
        (frontViewSupport
          ? (thresholds.supportingAnkleConfidence ?? thresholds.landmarkConfidence)
          : thresholds.landmarkConfidence) ||
      !shoulder ||
      !hip ||
      !knee ||
      !ankle
    ) {
      return { frameEvidence: 'UNKNOWN', side, confidence, credible: false };
    }

    const upperLegX = knee.x - hip.x;
    const upperLegY = knee.y - hip.y;
    const lowerLegX = ankle.x - knee.x;
    const lowerLegY = ankle.y - knee.y;
    const upperLegSquared = upperLegX ** 2 + upperLegY ** 2;
    const kneeAngle = calculateAngle(hip, knee, ankle) ?? undefined;
    const legChainAngle = calculateAngle(shoulder, hip, knee) ?? undefined;
    if (!kneeAngle || !legChainAngle || upperLegSquared <= 1e-8) {
      return { frameEvidence: 'UNKNOWN', side, confidence, credible: false };
    }

    const ankleExtensionRatio = (lowerLegX * upperLegX + lowerLegY * upperLegY) / upperLegSquared;
    const ankleDeviationRatio =
      Math.abs(lowerLegX * upperLegY - lowerLegY * upperLegX) / upperLegSquared;
    const standard =
      kneeAngle >= thresholds.standardMinimumKneeAngle &&
      legChainAngle >= thresholds.minimumLegChainAngle &&
      (frontViewSupport || ankleExtensionRatio >= thresholds.standardMinimumAnkleExtensionRatio);
    const modified =
      kneeAngle <= thresholds.modifiedMaximumKneeAngle &&
      ankleDeviationRatio >= thresholds.modifiedMinimumAnkleDeviationRatio;

    return {
      frameEvidence: modified ? 'MODIFIED_KNEE' : standard ? 'STANDARD' : 'UNKNOWN',
      side,
      confidence,
      credible: true,
      kneeAngle,
      legChainAngle,
      ankleExtensionRatio,
      ankleDeviationRatio,
    };
  }
}
