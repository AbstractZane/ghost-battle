import { calculateAngle, landmarkDistance } from './poseMath';
import { confidenceForSide, landmarksForSide, type SideConfidenceSnapshot } from './sideSelector';
import type { PoseLandmark, PoseLandmarks, PoseResult, PoseSide } from './poseTypes';

export type SetupState = 'NO_PERSON' | 'PERSON_FOUND' | 'POSITIONING' | 'READY' | 'ACTIVE';
export type RequiredLandmark = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle';

export type RequiredLandmarkConfidences = Record<RequiredLandmark, number>;

/**
 * Readiness geometry must use the camera source aspect ratio everywhere. Using
 * projected overlay dimensions or a square inference tensor changes physical
 * segment lengths between calibration and the active workout. PoseResult's
 * adapters already use one source scale for both axes; do not apply it twice.
 */
export function poseSourceGeometry(
  pose: Pick<PoseResult, 'sourceWidth' | 'sourceHeight'>,
): PoseGeometryContext {
  return {
    sourceWidth: pose.sourceWidth,
    sourceHeight: pose.sourceHeight,
    canonicalCoordinates: true,
  };
}

export interface PoseGeometryContext {
  sourceWidth: number;
  sourceHeight: number;
  /** PoseResult already uses the longest source dimension for both axes. */
  canonicalCoordinates?: boolean;
}

export interface PoseReadinessThresholds {
  individualCoreFloor: number;
  coreAggregate: number;
  supporting: number;
  bilateralCore: number;
  minimumCoreSegmentLength: number;
  minimumTorsoLength: number;
  maximumTorsoLength: number;
  minimumArmToTorsoRatio: number;
  maximumArmToTorsoRatio: number;
  maximumBilateralSeparationToTorsoRatio: number;
}

export interface GeometryFailure {
  metric: string;
  value: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface PoseGeometryDiagnostics {
  coordinateSpace: 'aspect-corrected normalized source';
  sourceWidth: number;
  sourceHeight: number;
  shoulderElbowDistance: number | null;
  elbowWristDistance: number | null;
  shoulderHipDistance: number | null;
  upperArmToTorsoRatio: number | null;
  forearmToTorsoRatio: number | null;
  elbowAngle: number | null;
  bilateralSeparationToTorsoRatio: number | null;
  bilateralCheckApplied: boolean;
  failure: GeometryFailure | null;
}

export interface PoseQualityResult {
  state: SetupState;
  feedback: string;
  visible: boolean;
  side: PoseSide;
  requiredLandmarks: RequiredLandmarkConfidences;
  coreScore: number;
  supportingScore: number;
  thresholds: PoseReadinessThresholds;
  geometry: PoseGeometryDiagnostics | null;
  failureReason: string | null;
  failurePriority: number;
}

interface ReadinessStabilityOptions {
  readyConfirmationMs: number;
  landmarkGraceMs: number;
  messageHoldMs: number;
}

const DEFAULT_STABILITY_OPTIONS: Readonly<ReadinessStabilityOptions> = {
  readyConfirmationMs: 500,
  landmarkGraceMs: 300,
  messageHoldMs: 750,
};

const CORE_LANDMARKS = ['shoulder', 'elbow', 'wrist', 'hip'] as const;
const LANDMARK_PRIORITY: ReadonlyArray<RequiredLandmark> = [
  'shoulder',
  'hip',
  'elbow',
  'wrist',
  'knee',
  'ankle',
];

function landmarkFailure(
  side: PoseSide,
  landmark: RequiredLandmark,
  confidence: number,
  threshold: number,
): string {
  return `INDIVIDUAL CORE FLOOR: ${side.toUpperCase()} ${landmark.toUpperCase()} ${confidence.toFixed(2)} < ${threshold.toFixed(2)}`;
}

function geometryLandmark(
  landmark: PoseLandmark | undefined,
  context: PoseGeometryContext,
): PoseLandmark | undefined {
  if (!landmark) return undefined;
  const maximumDimension = Math.max(context.sourceWidth, context.sourceHeight);
  if (!Number.isFinite(maximumDimension) || maximumDimension <= 0) return undefined;
  if (context.canonicalCoordinates) return landmark;
  return {
    ...landmark,
    x: (landmark.x * context.sourceWidth) / maximumDimension,
    y: (landmark.y * context.sourceHeight) / maximumDimension,
  };
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

function outsideRange(
  metric: string,
  value: number | null,
  minimum: number | null,
  maximum: number | null,
): GeometryFailure | null {
  if (value === null || !Number.isFinite(value)) return { metric, value, minimum, maximum };
  if (minimum !== null && value < minimum) return { metric, value, minimum, maximum };
  if (maximum !== null && value > maximum) return { metric, value, minimum, maximum };
  return null;
}

function describeGeometryFailure(failure: GeometryFailure): string {
  const value = failure.value === null ? 'null' : failure.value.toFixed(4);
  const range =
    failure.minimum !== null && failure.maximum !== null
      ? `[${failure.minimum.toFixed(4)}, ${failure.maximum.toFixed(4)}]`
      : failure.minimum !== null
        ? `>= ${failure.minimum.toFixed(4)}`
        : `<= ${(failure.maximum ?? 0).toFixed(4)}`;
  return `CORE LANDMARK GEOMETRY IS NOT PLAUSIBLE: ${failure.metric}=${value}, accepted ${range}, coordinateSpace=aspect-corrected normalized source`;
}

function reliableBilateralCore(confidence: SideConfidenceSnapshot, threshold: number): boolean {
  return (
    confidence.coreScore >= threshold &&
    CORE_LANDMARKS.every((landmark) => confidence.landmarks[landmark] >= threshold)
  );
}

function baseResult(
  side: PoseSide,
  confidence: SideConfidenceSnapshot,
  thresholds: PoseReadinessThresholds,
) {
  return {
    side,
    requiredLandmarks: confidence.landmarks,
    coreScore: confidence.coreScore,
    supportingScore: confidence.supportingScore,
    thresholds,
  };
}

export function evaluatePoseQuality(
  landmarks: PoseLandmarks,
  side: PoseSide,
  thresholds: PoseReadinessThresholds,
  context: PoseGeometryContext = { sourceWidth: 1, sourceHeight: 1 },
): PoseQualityResult {
  const names = landmarksForSide(side);
  const sideConfidence = confidenceForSide(landmarks, side);
  const requiredLandmarks = sideConfidence.landmarks;
  const unusableCore = CORE_LANDMARKS.find(
    (landmark) => requiredLandmarks[landmark] < thresholds.individualCoreFloor,
  );

  if (unusableCore) {
    const torsoMissing = unusableCore === 'shoulder' || unusableCore === 'hip';
    return {
      ...baseResult(side, sideConfidence, thresholds),
      state: torsoMissing ? 'NO_PERSON' : 'POSITIONING',
      feedback: `SHOW ${side.toUpperCase()} ${unusableCore.toUpperCase()}`,
      visible: !torsoMissing,
      geometry: null,
      failureReason: landmarkFailure(
        side,
        unusableCore,
        requiredLandmarks[unusableCore],
        thresholds.individualCoreFloor,
      ),
      failurePriority: LANDMARK_PRIORITY.indexOf(unusableCore) + 10,
    };
  }

  if (sideConfidence.coreScore < thresholds.coreAggregate) {
    return {
      ...baseResult(side, sideConfidence, thresholds),
      state: 'POSITIONING',
      feedback: `IMPROVE ${side.toUpperCase()} CORE VISIBILITY`,
      visible: true,
      geometry: null,
      failureReason: `CORE AGGREGATE: ${side.toUpperCase()} ${sideConfidence.coreScore.toFixed(2)} < ${thresholds.coreAggregate.toFixed(2)}`,
      failurePriority: 8,
    };
  }

  const selectedShoulder = geometryLandmark(landmarks[names.shoulder], context);
  const selectedElbow = geometryLandmark(landmarks[names.elbow], context);
  const selectedWrist = geometryLandmark(landmarks[names.wrist], context);
  const selectedHip = geometryLandmark(landmarks[names.hip], context);
  const shoulderElbowDistance = landmarkDistance(selectedShoulder, selectedElbow);
  const elbowWristDistance = landmarkDistance(selectedElbow, selectedWrist);
  const shoulderHipDistance = landmarkDistance(selectedShoulder, selectedHip);
  const upperArmToTorsoRatio = ratio(shoulderElbowDistance, shoulderHipDistance);
  const forearmToTorsoRatio = ratio(elbowWristDistance, shoulderHipDistance);
  const elbowAngle = calculateAngle(selectedShoulder, selectedElbow, selectedWrist);
  const geometryFailures = [
    outsideRange(
      'shoulder-elbow-distance',
      shoulderElbowDistance,
      thresholds.minimumCoreSegmentLength,
      null,
    ),
    outsideRange(
      'elbow-wrist-distance',
      elbowWristDistance,
      thresholds.minimumCoreSegmentLength,
      null,
    ),
    outsideRange(
      'shoulder-hip-distance',
      shoulderHipDistance,
      thresholds.minimumTorsoLength,
      thresholds.maximumTorsoLength,
    ),
    outsideRange(
      'shoulder-elbow/shoulder-hip-ratio',
      upperArmToTorsoRatio,
      thresholds.minimumArmToTorsoRatio,
      thresholds.maximumArmToTorsoRatio,
    ),
    outsideRange(
      'elbow-wrist/shoulder-hip-ratio',
      forearmToTorsoRatio,
      thresholds.minimumArmToTorsoRatio,
      thresholds.maximumArmToTorsoRatio,
    ),
    outsideRange('elbow-angle-degrees', elbowAngle, 0, 180),
  ];
  const geometryFailure = geometryFailures.find(
    (failure): failure is GeometryFailure => failure !== null,
  );
  const geometry: PoseGeometryDiagnostics = {
    coordinateSpace: 'aspect-corrected normalized source',
    sourceWidth: context.sourceWidth,
    sourceHeight: context.sourceHeight,
    shoulderElbowDistance,
    elbowWristDistance,
    shoulderHipDistance,
    upperArmToTorsoRatio,
    forearmToTorsoRatio,
    elbowAngle,
    bilateralSeparationToTorsoRatio: null,
    bilateralCheckApplied: false,
    failure: geometryFailure ?? null,
  };
  if (geometryFailure) {
    return {
      ...baseResult(side, sideConfidence, thresholds),
      state: 'POSITIONING',
      feedback: 'KEEP YOUR ARM AND TORSO IN FRAME',
      visible: true,
      geometry,
      failureReason: describeGeometryFailure(geometryFailure),
      failurePriority: 6,
    };
  }

  // Far-side geometry is only evidence when every core landmark on both sides is
  // independently reliable. An occluded side never participates in this check.
  const leftConfidence = confidenceForSide(landmarks, 'left');
  const rightConfidence = confidenceForSide(landmarks, 'right');
  const bilateralCheckApplied =
    reliableBilateralCore(leftConfidence, thresholds.bilateralCore) &&
    reliableBilateralCore(rightConfidence, thresholds.bilateralCore);
  geometry.bilateralCheckApplied = bilateralCheckApplied;
  if (bilateralCheckApplied && shoulderHipDistance !== null && shoulderHipDistance > 0) {
    const shoulderWidth = landmarkDistance(
      geometryLandmark(landmarks.leftShoulder, context),
      geometryLandmark(landmarks.rightShoulder, context),
    );
    const hipWidth = landmarkDistance(
      geometryLandmark(landmarks.leftHip, context),
      geometryLandmark(landmarks.rightHip, context),
    );
    if (shoulderWidth !== null && hipWidth !== null) {
      geometry.bilateralSeparationToTorsoRatio =
        (shoulderWidth + hipWidth) / 2 / shoulderHipDistance;
    }
  }
  // Bilateral width describes the viewing angle, not tracking validity. A front
  // view can have a wide shoulder span and a foreshortened torso. Keep this metric
  // for diagnostics; completed-rep eligibility belongs to the exercise detector.

  return {
    ...baseResult(side, sideConfidence, thresholds),
    state: 'READY',
    feedback: 'READY',
    visible: true,
    geometry,
    failureReason: null,
    failurePriority: 0,
  };
}

export class StablePoseReadiness {
  private readySince: number | null = null;
  private lastReadyFrameAt: number | null = null;
  private stableReady = false;
  private heldFailure: PoseQualityResult | null = null;
  private heldFailureSince = 0;

  constructor(private readonly options: ReadinessStabilityOptions = DEFAULT_STABILITY_OPTIONS) {}

  reset(): void {
    this.readySince = null;
    this.lastReadyFrameAt = null;
    this.stableReady = false;
    this.heldFailure = null;
    this.heldFailureSince = 0;
  }

  update(result: PoseQualityResult, timestamp: number): PoseQualityResult {
    if (result.state === 'READY') {
      this.lastReadyFrameAt = timestamp;
      this.heldFailure = null;
      this.readySince ??= timestamp;
      if (timestamp - this.readySince >= this.options.readyConfirmationMs) {
        this.stableReady = true;
        return result;
      }
      return {
        ...result,
        state: 'POSITIONING',
        feedback: 'HOLD POSITION',
        failureReason: 'WAITING FOR STABLE READINESS',
      };
    }

    const withinGrace =
      this.lastReadyFrameAt !== null &&
      timestamp - this.lastReadyFrameAt <= this.options.landmarkGraceMs;
    if (withinGrace) {
      return {
        ...result,
        state: this.stableReady ? 'READY' : 'POSITIONING',
        feedback: this.stableReady ? 'READY' : 'HOLD POSITION',
      };
    }

    this.readySince = null;
    this.stableReady = false;
    if (
      this.heldFailure === null ||
      result.failurePriority < this.heldFailure.failurePriority ||
      timestamp - this.heldFailureSince >= this.options.messageHoldMs
    ) {
      this.heldFailure = result;
      this.heldFailureSince = timestamp;
    }
    return {
      ...result,
      feedback: this.heldFailure.feedback,
    };
  }
}
