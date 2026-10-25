import type { ExerciseDetector } from '@/exercises/ExerciseDetector';
import { analyzePushupForm } from '@/exercises/pushup/PushupFormAnalyzer';
import { DEFAULT_PUSHUP_RULES, type PushupRules } from '@/exercises/pushup/pushupRules';
import type {
  ExerciseDetectionResult,
  PushupElbowSource,
  PushupMetrics,
  PushupState,
  RejectedRepReason,
} from '@/exercises/pushup/pushupTypes';
import { calculateAngle } from '@/pose/poseMath';
import {
  confidenceForSide,
  landmarksForSide,
  type SideConfidenceSnapshot,
} from '@/pose/sideSelector';
import type { PoseLandmark, PoseLandmarkName, PoseResult, PoseSide } from '@/pose/poseTypes';
import type { ExerciseRep } from '@/types/models';
import { hasFrontViewPlankSupport } from '../frontViewPlank';

interface ArmMeasurement {
  angle: number;
  confidence: number;
  side: PoseSide;
}

interface KneeEvidence {
  frameEvidence: 'MODIFIED_KNEE' | 'STANDARD' | 'UNKNOWN';
  angle?: number;
  confidence?: number;
  side?: PoseSide;
  ankleDeviationRatio?: number;
  reason?:
    | 'LOWER_BODY_NOT_OBSERVED'
    | 'BILATERAL_CONFLICT'
    | 'BENT_KNEE'
    | 'STRAIGHT_LEG'
    | 'AMBIGUOUS_GEOMETRY';
}

interface UprightEvidence {
  upright: boolean;
  torsoAngle?: number;
  wristHeightToHipRatio?: number;
}

interface ActiveCandidate {
  startedAt: number;
  minimumAngle: number;
  maximumAngle: number;
  confidenceTotal: number;
  samples: number;
  bodyAngleTotal: number;
  bodySamples: number;
  modifiedEvidenceMs: number;
  modifiedUnknownSince: number | null;
  modifiedEvidenceAt: number;
  previousFrameModified: boolean;
  modifiedConfirmed: boolean;
  uprightEvidenceMs: number;
  previousFrameUpright: boolean;
  uprightConfirmed: boolean;
  bottomEvidenceSince: number | null;
  bottomEvidenceMinimumAngle: number;
  bottomConfirmed: boolean;
}

/**
 * V6 is a deliberately small, camera-placement-tolerant push-up counter.
 *
 * It only needs one reliable arm chain. When both arms are visible, their
 * elbow angles are confidence-weighted into a single measurement. Lower-body
 * landmarks are optional form metadata, not a readiness prerequisite.
 */
export class PushupDetectorV6 implements ExerciseDetector {
  private paused = false;
  private totalReps = 0;
  private phase: PushupState = 'NOT_READY';
  private readySince: number | null = null;
  private lostSince: number | null = null;
  private candidate: ActiveCandidate | null = null;
  private completedCandidate: ActiveCandidate | null = null;
  private completedAt: number | null = null;
  private lastTimestamp: number | null = null;
  private lastArmSample: { timestamp: number; angle: number } | null = null;
  private armVelocity: number | undefined;
  private lastRejection: RejectedRepReason | undefined;
  private modifiedKnee = false;
  private kneeEvidence: KneeEvidence = { frameEvidence: 'UNKNOWN' };
  private uprightEvidence: UprightEvidence = { upright: false };

  constructor(private rules: PushupRules = { ...DEFAULT_PUSHUP_RULES }) {}

  setRules(rules: Partial<PushupRules>): void {
    this.rules = { ...this.rules, ...rules };
    this.resetRuntime();
  }

  getRules(): Readonly<PushupRules> {
    return this.rules;
  }

  /** Derived diagnostics; preserve count-time veto evidence after completion. */
  getPostureDiagnostics() {
    const evidence = this.candidate ?? this.completedCandidate;
    return {
      scope: this.candidate
        ? 'active-candidate'
        : this.completedCandidate
          ? 'completed-candidate'
          : 'none',
      completedAt: this.completedAt,
      kneeEvidence: this.kneeEvidence.frameEvidence,
      kneeEvidenceReason: this.kneeEvidence.reason,
      kneeEvidenceConfidence: this.kneeEvidence.confidence,
      kneeEvidenceSide: this.kneeEvidence.side,
      modifiedEvidenceMs: evidence?.modifiedEvidenceMs ?? 0,
      modifiedUnknownSince: evidence?.modifiedUnknownSince ?? null,
      modifiedRequiredMs: this.rules.v6ModifiedEvidenceMs,
      modifiedUnknownGraceMs: this.rules.v6ModifiedUnknownGraceMs,
      modifiedConfirmed: evidence?.modifiedConfirmed ?? false,
      uprightEvidenceMs: evidence?.uprightEvidenceMs ?? 0,
      uprightRequiredMs: this.rules.v6UprightEvidenceMs,
      uprightConfirmed: evidence?.uprightConfirmed ?? false,
      bottomConfirmed: evidence?.bottomConfirmed ?? false,
      candidateStartedAt: evidence?.startedAt ?? null,
      candidateElapsedMs: evidence
        ? Math.max(
            0,
            (this.candidate ? this.lastTimestamp : this.completedAt)! - evidence.startedAt,
          )
        : 0,
      minimumElbowAngle: evidence?.minimumAngle ?? null,
      maximumElbowAngle: evidence?.maximumAngle ?? null,
      armVelocity: this.armVelocity,
      armArtifactGuard: this.rules.v6RejectArmArtifacts === 1,
    };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.resetRuntime();
  }

  reset(): void {
    this.totalReps = 0;
    this.paused = false;
    this.lastRejection = undefined;
    this.resetRuntime();
  }

  processPose(pose: PoseResult, timestamp = pose.timestamp): ExerciseDetectionResult {
    if (
      !Number.isFinite(timestamp) ||
      (this.lastTimestamp !== null && timestamp <= this.lastTimestamp)
    ) {
      return this.result(null, null, null, undefined, 'INVALID_SEQUENCE');
    }
    if (
      this.lastTimestamp !== null &&
      timestamp - this.lastTimestamp > this.rules.v6TrackingGraceMs
    ) {
      if (this.candidate) this.lastRejection = 'TRACKING_LOST';
      this.resetRuntime();
    }
    this.lastTimestamp = timestamp;
    if (this.paused) return { ...this.result(null, null, null, undefined), feedback: 'PAUSED' };

    const left = confidenceForSide(pose.landmarks, 'left');
    const right = confidenceForSide(pose.landmarks, 'right');
    const measurement = this.measureArm(pose, left, right);
    // Pose Engine's shared signal quality intentionally requires a hip for V4/V5
    // posture validation. V6 readiness is arm-only by design, so do not let that
    // aggregate flag quietly reintroduce hip/leg gating here.
    const visible = measurement !== null;
    if (!visible) return this.handleLost(timestamp, left, right);

    const velocity = this.lastArmSample
      ? ((measurement.angle - this.lastArmSample.angle) * 1000) /
        (timestamp - this.lastArmSample.timestamp)
      : undefined;
    if (
      this.rules.v6RejectArmArtifacts === 1 &&
      velocity !== undefined &&
      Math.abs(velocity) > this.rules.v6MaximumAngularVelocity
    ) {
      // Discard the partial cycle, not accepted reps. A joint/source jump must
      // never provide a bottom or return-top. Reacquire an observed top first.
      this.resetRuntime();
      this.lastTimestamp = timestamp;
      this.lastArmSample = { timestamp, angle: measurement.angle };
      this.armVelocity = velocity;
      this.lastRejection = 'IMPOSSIBLE_MOTION';
      return this.result(null, left, right, undefined, 'IMPOSSIBLE_MOTION');
    }
    this.lastArmSample = { timestamp, angle: measurement.angle };
    this.armVelocity = velocity;

    this.lostSince = null;
    this.readySince ??= timestamp;
    this.kneeEvidence = this.measureKneeSupport(pose);
    this.modifiedKnee = this.kneeEvidence.frameEvidence === 'MODIFIED_KNEE';
    this.uprightEvidence = this.measureUprightPosture(pose);
    const ready = timestamp - this.readySince >= this.rules.v6ReadyConfirmationMs;
    const bodyAngle = this.optionalBodyAngle(pose, measurement.side);
    let rep: ExerciseRep | undefined;
    let rejectedReason: RejectedRepReason | undefined;

    if (!ready) {
      this.phase = 'NOT_READY';
    } else {
      ({ rep, rejectedReason } = this.advance(measurement, timestamp, bodyAngle));
    }
    if (rejectedReason) this.lastRejection = rejectedReason;
    // Build the public result after the count advances, so the completion
    // frame and all later frames agree on the cumulative total.
    if (rep) this.totalReps += 1;
    return this.result(measurement, left, right, bodyAngle, rejectedReason, rep);
  }

  private advance(
    measurement: ArmMeasurement,
    timestamp: number,
    bodyAngle: number | undefined,
  ): { rep?: ExerciseRep; rejectedReason?: RejectedRepReason } {
    const angle = measurement.angle;
    if (this.candidate) this.recordCandidate(measurement, timestamp, bodyAngle);
    if (
      this.candidate &&
      timestamp - this.candidate.startedAt > this.rules.v6MaximumRepDurationMs
    ) {
      this.candidate = null;
      this.phase = angle >= this.rules.v6TopElbowAngle ? 'UP' : 'NOT_READY';
      return { rejectedReason: 'INVALID_SEQUENCE' };
    }
    switch (this.phase) {
      case 'NOT_READY':
        if (angle >= this.rules.v6TopElbowAngle) this.phase = 'UP';
        break;
      case 'UP':
        if (angle <= this.rules.v6StartDescentElbowAngle) {
          // Low-FPS input may already be at bottom; do not require a second
          // bottom frame merely to walk through an intermediate state.
          this.phase = angle <= this.rules.v6BottomElbowAngle ? 'DOWN' : 'DESCENDING';
          this.beginCandidate(measurement, timestamp, bodyAngle);
        }
        break;
      case 'DESCENDING':
        if (angle <= this.rules.v6BottomElbowAngle) this.phase = 'DOWN';
        else if (angle >= this.rules.v6TopElbowAngle) {
          this.phase = 'UP';
          this.candidate = null;
          return { rejectedReason: 'INSUFFICIENT_DEPTH' };
        }
        break;
      case 'DOWN':
        if (angle >= this.rules.v6StartAscentElbowAngle) {
          this.phase = 'ASCENDING';
          if (angle >= this.rules.v6ReturnTopElbowAngle) return this.completeCandidate(timestamp);
        }
        break;
      case 'ASCENDING':
        if (angle >= this.rules.v6ReturnTopElbowAngle) {
          return this.completeCandidate(timestamp);
        }
        if (angle <= this.rules.v6BottomElbowAngle) this.phase = 'DOWN';
        break;
    }
    return {};
  }

  private completeCandidate(timestamp: number): {
    rep?: ExerciseRep;
    rejectedReason?: RejectedRepReason;
  } {
    const candidate = this.candidate;
    this.completedCandidate = candidate;
    this.completedAt = timestamp;
    this.candidate = null;
    this.phase = 'UP';
    if (!candidate || timestamp - candidate.startedAt < this.rules.v6MinimumRepDurationMs) {
      return { rejectedReason: 'MOVEMENT_TOO_FAST' };
    }
    if (candidate.modifiedConfirmed) {
      return { rejectedReason: 'MODIFIED_PUSHUP' };
    }
    if (candidate.uprightConfirmed) return { rejectedReason: 'BODY_ALIGNMENT' };
    if (!candidate.bottomConfirmed) return { rejectedReason: 'INSUFFICIENT_DEPTH' };
    const form = analyzePushupForm({
      minimumElbowAngle: candidate.minimumAngle,
      maximumElbowAngle: candidate.maximumAngle,
      averageBodyAngle:
        candidate.bodySamples > 0 ? candidate.bodyAngleTotal / candidate.bodySamples : 170,
      averageConfidence: candidate.confidenceTotal / candidate.samples,
      durationMs: timestamp - candidate.startedAt,
    });
    return {
      rep: {
        index: this.totalReps + 1,
        timestamp,
        durationMs: timestamp - candidate.startedAt,
        minimumElbowAngle: Math.round(candidate.minimumAngle),
        maximumElbowAngle: Math.round(candidate.maximumAngle),
        averageBodyAngle: Math.round(
          candidate.bodySamples > 0 ? candidate.bodyAngleTotal / candidate.bodySamples : 170,
        ),
        qualityScore: form.qualityScore,
        grade: form.grade,
      },
    };
  }

  private beginCandidate(
    measurement: ArmMeasurement,
    timestamp: number,
    bodyAngle: number | undefined,
  ): void {
    this.completedCandidate = null;
    this.completedAt = null;
    this.candidate = {
      startedAt: timestamp,
      minimumAngle: measurement.angle,
      maximumAngle: measurement.angle,
      confidenceTotal: measurement.confidence,
      samples: 1,
      bodyAngleTotal: bodyAngle ?? 0,
      bodySamples: bodyAngle === undefined ? 0 : 1,
      modifiedEvidenceMs: 0,
      modifiedUnknownSince: null,
      modifiedEvidenceAt: timestamp,
      previousFrameModified: this.modifiedKnee,
      modifiedConfirmed: false,
      uprightEvidenceMs: 0,
      previousFrameUpright: this.uprightEvidence.upright,
      uprightConfirmed: false,
      bottomEvidenceSince: null,
      bottomEvidenceMinimumAngle: Infinity,
      bottomConfirmed: false,
    };
    this.recordBottomEvidence(measurement.angle, timestamp);
  }

  private recordCandidate(
    measurement: ArmMeasurement,
    timestamp: number,
    bodyAngle: number | undefined,
  ): void {
    if (!this.candidate) return;
    this.candidate.minimumAngle = Math.min(this.candidate.minimumAngle, measurement.angle);
    this.candidate.maximumAngle = Math.max(this.candidate.maximumAngle, measurement.angle);
    this.candidate.confidenceTotal += measurement.confidence;
    this.candidate.samples += 1;
    if (bodyAngle !== undefined) {
      this.candidate.bodyAngleTotal += bodyAngle;
      this.candidate.bodySamples += 1;
    }
    const modified = this.modifiedKnee;
    const elapsed = Math.min(
      this.rules.v6TrackingGraceMs,
      Math.max(0, timestamp - this.candidate.modifiedEvidenceAt),
    );
    this.candidate.modifiedEvidenceAt = timestamp;
    const unknown = this.kneeEvidence.frameEvidence === 'UNKNOWN';
    if (unknown) this.candidate.modifiedUnknownSince ??= timestamp;
    const unknownExpired =
      this.candidate.modifiedUnknownSince !== null &&
      timestamp - this.candidate.modifiedUnknownSince > this.rules.v6ModifiedUnknownGraceMs;
    if (unknownExpired || (!modified && !unknown)) this.candidate.modifiedEvidenceMs = 0;
    if (modified && this.candidate.previousFrameModified)
      this.candidate.modifiedEvidenceMs += elapsed;
    // UNKNOWN contributes no evidence time. A credible straight leg clears
    // unconfirmed bent-knee evidence immediately; isolated glitches cannot veto.
    if (!unknown) this.candidate.modifiedUnknownSince = null;
    this.candidate.previousFrameModified = modified;
    // Once sustained knee support is established, an occluded ankle at
    // lockout must not erase it. Only the current candidate is vetoed.
    this.candidate.modifiedConfirmed ||=
      this.candidate.modifiedEvidenceMs >= this.rules.v6ModifiedEvidenceMs;
    this.candidate.uprightEvidenceMs =
      this.uprightEvidence.upright && this.candidate.previousFrameUpright
        ? this.candidate.uprightEvidenceMs + elapsed
        : 0;
    this.candidate.previousFrameUpright = this.uprightEvidence.upright;
    this.candidate.uprightConfirmed ||=
      this.candidate.uprightEvidenceMs >= this.rules.v6UprightEvidenceMs;
    this.recordBottomEvidence(measurement.angle, timestamp);
  }

  private recordBottomEvidence(angle: number, timestamp: number): void {
    if (!this.candidate) return;
    if (angle > this.rules.v6BottomEvidenceElbowAngle) {
      this.candidate.bottomEvidenceSince = null;
      this.candidate.bottomEvidenceMinimumAngle = Infinity;
      return;
    }
    this.candidate.bottomEvidenceSince ??= timestamp;
    this.candidate.bottomEvidenceMinimumAngle = Math.min(
      this.candidate.bottomEvidenceMinimumAngle,
      angle,
    );
    this.candidate.bottomConfirmed ||=
      angle <= this.rules.v6StrongBottomElbowAngle ||
      (this.candidate.bottomEvidenceMinimumAngle <= this.rules.v6BottomElbowAngle &&
        timestamp - this.candidate.bottomEvidenceSince >= this.rules.v6BottomConfirmationMs);
  }

  private handleLost(
    timestamp: number,
    left: SideConfidenceSnapshot,
    right: SideConfidenceSnapshot,
  ): ExerciseDetectionResult {
    this.modifiedKnee = false;
    this.kneeEvidence = { frameEvidence: 'UNKNOWN' };
    this.uprightEvidence = { upright: false };
    if (this.candidate) {
      this.candidate.bottomEvidenceSince = null;
      this.candidate.bottomEvidenceMinimumAngle = Infinity;
      this.candidate.previousFrameModified = false;
      this.candidate.modifiedEvidenceMs = 0;
      this.candidate.modifiedUnknownSince = null;
      this.candidate.previousFrameUpright = false;
      this.candidate.uprightEvidenceMs = 0;
    }
    this.lostSince ??= timestamp;
    if (timestamp - this.lostSince > this.rules.v6TrackingGraceMs) {
      const hadCandidate = this.candidate !== null;
      this.resetRuntime();
      return this.result(null, left, right, undefined, hadCandidate ? 'TRACKING_LOST' : undefined);
    }
    return this.result(null, left, right, undefined);
  }

  private measureArm(
    pose: PoseResult,
    left: SideConfidenceSnapshot,
    right: SideConfidenceSnapshot,
  ): ArmMeasurement | null {
    const measurements = (['left', 'right'] as const)
      .map((side) => {
        const confidence = side === 'left' ? left : right;
        if (
          confidence.landmarks.shoulder < this.rules.v6ArmLandmarkConfidence ||
          confidence.landmarks.elbow < this.rules.v6ArmLandmarkConfidence ||
          confidence.landmarks.wrist < this.rules.v6ArmLandmarkConfidence
        ) {
          return null;
        }
        const names = landmarksForSide(side);
        const angle = calculateAngle(
          pose.landmarks[names.shoulder],
          pose.landmarks[names.elbow],
          pose.landmarks[names.wrist],
        );
        return angle === null ? null : { angle, confidence: this.armConfidence(confidence), side };
      })
      .filter((measurement): measurement is ArmMeasurement => measurement !== null);
    if (measurements.length === 0) return null;
    if (measurements.length === 1) return measurements[0] ?? null;
    const [first, second] = measurements;
    if (!first || !second) return null;
    const totalConfidence = first.confidence + second.confidence;
    return {
      angle: (first.angle * first.confidence + second.angle * second.confidence) / totalConfidence,
      confidence: totalConfidence / 2,
      side: first.confidence >= second.confidence ? first.side : second.side,
    };
  }

  private optionalBodyAngle(pose: PoseResult, side: PoseSide): number | undefined {
    const names = landmarksForSide(side);
    const endpoint = this.usable(pose.landmarks[names.ankle])
      ? pose.landmarks[names.ankle]
      : this.usable(pose.landmarks[names.knee])
        ? pose.landmarks[names.knee]
        : undefined;
    return (
      calculateAngle(pose.landmarks[names.shoulder], pose.landmarks[names.hip], endpoint) ??
      undefined
    );
  }

  /** Strong hips/knees can use a weaker distal ankle as supporting evidence.
   * Missing/predicted joints stay neutral; no hidden joint is synthesized. */
  private measureKneeSupport(pose: PoseResult): KneeEvidence {
    const evidence = (['left', 'right'] as const).flatMap((side) => {
      const names = landmarksForSide(side);
      const hip = pose.landmarks[names.hip];
      const knee = pose.landmarks[names.knee];
      const ankle = pose.landmarks[names.ankle];
      if (
        !hip ||
        !knee ||
        !ankle ||
        this.observedConfidence(pose, names.hip) < this.rules.v6VariantLandmarkConfidence ||
        this.observedConfidence(pose, names.knee) < this.rules.v6VariantLandmarkConfidence ||
        this.observedConfidence(pose, names.ankle) < this.rules.v6SupportingAnkleConfidence
      ) {
        return [];
      }
      const angle = calculateAngle(hip, knee, ankle);
      if (angle === null) return [];
      const upperLegX = knee.x - hip.x;
      const upperLegY = knee.y - hip.y;
      const upperLegSquared = upperLegX ** 2 + upperLegY ** 2;
      if (upperLegSquared < this.rules.minimumCoreSegmentLength ** 2) return [];
      const ankleDeviationRatio =
        Math.abs((ankle.x - knee.x) * upperLegY - (ankle.y - knee.y) * upperLegX) / upperLegSquared;
      const ankleConfidence = this.observedConfidence(pose, names.ankle);
      const strongAnkle = ankleConfidence >= this.rules.v6VariantLandmarkConfidence;
      // A projected folded shin can lie almost along the thigh in the image.
      // Cross-axis deviation alone then misses it. Require a real-length shin,
      // a severely folded observed knee, and independently observed floor support.
      // This experimental branch cannot infer a missing ankle or trust a joint
      // collapsed onto the knee, and still requires temporal corroboration.
      const severeProjectedFold =
        hasFrontViewPlankSupport(pose, side, this.rules) &&
        angle <= this.rules.frontViewSevereFoldedKneeAngle &&
        Math.hypot(ankle.x - knee.x, ankle.y - knee.y) / Math.sqrt(upperLegSquared) >=
          this.rules.frontViewMinimumLowerLegRatio;
      const modified =
        angle <= this.rules.v6ModifiedKneeAngle &&
        (strongAnkle ||
          ankleDeviationRatio >= this.rules.modifiedMinimumAnkleDeviationRatio ||
          severeProjectedFold);
      const standard = strongAnkle && angle >= this.rules.standardMinimumKneeAngle;
      return [
        {
          angle,
          confidence: Math.min(
            this.observedConfidence(pose, names.hip),
            this.observedConfidence(pose, names.knee),
            ankleConfidence,
          ),
          side,
          ankleDeviationRatio,
          frameEvidence: modified
            ? ('MODIFIED_KNEE' as const)
            : standard
              ? ('STANDARD' as const)
              : ('UNKNOWN' as const),
        },
      ];
    });
    const modified = evidence.find((item) => item.frameEvidence === 'MODIFIED_KNEE');
    const standard = evidence.find((item) => item.frameEvidence === 'STANDARD');
    // Keep conflicting strong projected views neutral. A weak ankle alone
    // cannot assert a straight leg that cancels credible bent-knee evidence.
    if (modified && standard)
      return { ...modified, frameEvidence: 'UNKNOWN', reason: 'BILATERAL_CONFLICT' };
    const selected = modified ?? standard ?? evidence[0];
    return selected
      ? {
          ...selected,
          reason: modified ? 'BENT_KNEE' : standard ? 'STRAIGHT_LEG' : 'AMBIGUOUS_GEOMETRY',
        }
      : { frameEvidence: 'UNKNOWN', reason: 'LOWER_BODY_NOT_OBSERVED' };
  }

  private measureUprightPosture(pose: PoseResult): UprightEvidence {
    const evidence = (['left', 'right'] as const).flatMap((side) => {
      const names = landmarksForSide(side);
      const shoulder = pose.landmarks[names.shoulder];
      const hip = pose.landmarks[names.hip];
      const wrist = pose.landmarks[names.wrist];
      if (
        !shoulder ||
        !hip ||
        !wrist ||
        [names.shoulder, names.hip, names.wrist].some(
          (name) => this.observedConfidence(pose, name) < this.rules.v6VariantLandmarkConfidence,
        )
      )
        return [];
      const dx = hip.x - shoulder.x;
      const dy = hip.y - shoulder.y;
      const length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length < this.rules.minimumTorsoLength) return [];
      const torsoAngle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
      const wristHeightToHipRatio = (hip.y - wrist.y) / length;
      return [
        {
          torsoAngle,
          wristHeightToHipRatio,
          upright:
            dy > 0 &&
            torsoAngle >= this.rules.v6UprightTorsoAngle &&
            wristHeightToHipRatio >= this.rules.v6UprightWristAboveHipRatio,
        },
      ];
    });
    const representative = evidence.find((item) => item.upright) ?? evidence[0];
    return representative
      ? { ...representative, upright: evidence.every((item) => item.upright) }
      : { upright: false };
  }

  private observedConfidence(pose: PoseResult, name: PoseLandmarkName): number {
    if (
      pose.tracking &&
      (!pose.tracking.freshLandmarks.includes(name) ||
        pose.tracking.predictedLandmarks?.includes(name) ||
        pose.tracking.rejectedLandmarks?.includes(name))
    ) {
      return 0;
    }
    const landmark = pose.landmarks[name];
    if (!landmark || ![landmark.x, landmark.y, landmark.confidence].every(Number.isFinite))
      return 0;
    return Math.min(
      landmark.confidence,
      pose.rawLandmarks?.[name]?.confidence ?? landmark.confidence,
    );
  }

  private usable(landmark: PoseLandmark | undefined): landmark is PoseLandmark {
    return (landmark?.confidence ?? 0) >= this.rules.v6ArmLandmarkConfidence;
  }

  private armConfidence(snapshot: SideConfidenceSnapshot): number {
    const { shoulder, elbow, wrist } = snapshot.landmarks;
    return (shoulder + elbow + wrist) / 3;
  }

  private result(
    measurement: ArmMeasurement | null,
    left: SideConfidenceSnapshot | null,
    right: SideConfidenceSnapshot | null,
    bodyAngle: number | undefined,
    rejectedReason?: RejectedRepReason,
    rep?: ExerciseRep,
  ): ExerciseDetectionResult {
    const selected =
      measurement?.side ??
      ((left?.aggregateScore ?? 0) >= (right?.aggregateScore ?? 0) ? 'left' : 'right');
    const selectedConfidence = selected === 'left' ? left : right;
    const elbowSource: PushupElbowSource | undefined =
      measurement && left && right && this.bothArmsReliable(left, right)
        ? 'fused'
        : measurement?.side;
    const metrics: PushupMetrics = {
      elbowAngle: measurement?.angle,
      elbowVelocity: this.armVelocity,
      elbowSource,
      armSignalReliable: measurement !== null,
      bodyAngle,
      kneeAngle: this.kneeEvidence.angle,
      variantConfidence: this.kneeEvidence.confidence,
      variantSide: this.kneeEvidence.side,
      ankleDeviationRatio: this.kneeEvidence.ankleDeviationRatio,
      torsoAngleFromHorizontal: this.uprightEvidence.torsoAngle,
      wristHeightToHipRatio: this.uprightEvidence.wristHeightToHipRatio,
      postureEvidence:
        this.uprightEvidence.upright || rejectedReason === 'BODY_ALIGNMENT'
          ? 'UPRIGHT'
          : this.modifiedKnee || rejectedReason === 'MODIFIED_PUSHUP'
            ? 'KNEES_DOWN'
            : 'UNKNOWN',
      postureEvidenceMs: this.uprightEvidence.upright
        ? (this.candidate?.uprightEvidenceMs ?? 0)
        : (this.candidate?.modifiedEvidenceMs ?? 0),
      exerciseVariant:
        this.candidate?.modifiedConfirmed || rejectedReason === 'MODIFIED_PUSHUP'
          ? 'MODIFIED_KNEE'
          : this.kneeEvidence.frameEvidence === 'STANDARD'
            ? 'STANDARD'
            : 'UNKNOWN',
      variantFrameEvidence: this.kneeEvidence.frameEvidence,
      confidence: measurement?.confidence,
      selectedSide: selected,
      leftVisibility: left?.aggregateScore ?? 0,
      rightVisibility: right?.aggregateScore ?? 0,
      leftCoreConfidence: left?.coreScore ?? 0,
      rightCoreConfidence: right?.coreScore ?? 0,
      leftLandmarks: left?.landmarks ?? this.emptyLandmarks(),
      rightLandmarks: right?.landmarks ?? this.emptyLandmarks(),
      coreConfidence: selectedConfidence?.coreScore ?? 0,
      supportingConfidence: selectedConfidence?.supportingScore ?? 0,
      sideSelectionReason:
        elbowSource === 'fused' ? 'fused both reliable arms' : 'strongest reliable arm',
      sideSelectionAlternativeBetterMs: 0,
      bodyAlignmentSource: 'unavailable',
      armState: this.phase === 'NOT_READY' ? 'DISARMED' : 'ARMED',
      contextState: measurement && !this.uprightEvidence.upright ? 'PUSHUP' : 'NOT_PUSHUP',
      signalQuality: measurement ? 'GOOD' : 'LOST',
      motionPhase: this.phase,
      candidateActive: this.candidate !== null,
      candidateEligibility: this.candidate
        ? this.candidate.modifiedConfirmed
          ? 'MODIFIED_KNEE'
          : 'STANDARD'
        : 'INACTIVE',
      transitionAccepted: rep !== undefined,
      lastRejectionReason: rejectedReason ?? this.lastRejection,
    };
    return {
      state: this.phase,
      repCompleted: rep !== undefined,
      totalReps: this.totalReps,
      qualityScore: rep?.qualityScore,
      feedback: this.feedback(measurement, rejectedReason, rep),
      metrics,
      rep,
      rejectedReason,
    };
  }

  private bothArmsReliable(left: SideConfidenceSnapshot, right: SideConfidenceSnapshot): boolean {
    return [left, right].every((snapshot) =>
      [snapshot.landmarks.shoulder, snapshot.landmarks.elbow, snapshot.landmarks.wrist].every(
        (confidence) => confidence >= this.rules.v6ArmLandmarkConfidence,
      ),
    );
  }

  private emptyLandmarks(): SideConfidenceSnapshot['landmarks'] {
    return { shoulder: 0, elbow: 0, wrist: 0, hip: 0, knee: 0, ankle: 0 };
  }

  private feedback(
    measurement: ArmMeasurement | null,
    rejectedReason: RejectedRepReason | undefined,
    rep: ExerciseRep | undefined,
  ): string {
    if (rep) return 'FULL REP';
    if (rejectedReason === 'MOVEMENT_TOO_FAST') return 'SLOW DOWN';
    if (rejectedReason === 'INSUFFICIENT_DEPTH') return 'GO LOWER';
    if (rejectedReason === 'MODIFIED_PUSHUP') return 'LIFT YOUR KNEES';
    if (rejectedReason === 'BODY_ALIGNMENT') return 'GET INTO PUSHUP POSITION';
    if (rejectedReason === 'IMPOSSIBLE_MOTION') return 'STEADY YOUR ARM';
    if (!measurement) return 'SHOW AN ARM';
    if (this.phase === 'NOT_READY') return 'HOLD TOP POSITION';
    if (this.phase === 'UP') return 'READY';
    if (this.phase === 'DESCENDING') return 'GO LOWER';
    if (this.phase === 'DOWN') return 'PUSH';
    return 'FULLY EXTEND';
  }

  private resetRuntime(): void {
    this.completedCandidate = null;
    this.completedAt = null;
    this.phase = 'NOT_READY';
    this.readySince = null;
    this.lostSince = null;
    this.candidate = null;
    this.lastTimestamp = null;
    this.lastArmSample = null;
    this.armVelocity = undefined;
    this.modifiedKnee = false;
    this.kneeEvidence = { frameEvidence: 'UNKNOWN' };
    this.uprightEvidence = { upright: false };
  }
}
