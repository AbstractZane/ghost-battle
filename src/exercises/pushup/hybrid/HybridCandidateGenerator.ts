import { HYBRID_PUSHUP_RULES, type HybridPushupRules } from '@/exercises/pushup/pushupRules';
import { calculateAngle } from '@/pose/poseMath';
import { landmarksForSide } from '@/pose/sideSelector';
import type { PoseLandmark, PoseResult, PoseSide } from '@/pose/poseTypes';
import { hybridPoseGeometry } from './hybridPoseGeometry';

export type HybridCandidateState = 'SEEKING_TOP' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';

export interface HybridMotionCandidate {
  arm: PoseSide;
  startedAt: number;
  bottomAt: number;
  completedAt: number;
  durationMs: number;
  maximumElbowAngle: number;
  minimumElbowAngle: number;
  returnElbowAngle: number;
  maximumAngularVelocity: number;
  reliableArmSamples: number;
  totalSamples: number;
  horizontalBodySamples: number;
  bodySamples: number;
}

export interface HybridCandidateDiagnostics {
  trackingHeld?: boolean;
  state: HybridCandidateState;
  arm: PoseSide | null;
  durationMs: number;
  elbowAngle: number | null;
  rejectionReason: HybridCandidateRejection | null;
}

export type HybridCandidateRejection =
  | 'IMPOSSIBLE_VELOCITY'
  | 'TRACKING_LOSS'
  | 'DURATION'
  | 'BODY_ORIENTATION'
  | 'CAMERA_SHAKE'
  | 'INCOMPLETE_MOTION';

interface ArmObservation {
  angle: number;
  confidence: number;
  torsoAngle: number | null;
  root: { x: number; y: number } | null;
}

interface ArmHistory {
  previousAngle: number | null;
  previousAt: number | null;
  topAngle: number | null;
  topAt: number | null;
}

interface ActiveCandidate {
  recoveryStartedAt?: number | null;
  arm: PoseSide;
  state: Exclude<HybridCandidateState, 'SEEKING_TOP'>;
  startedAt: number;
  bottomAt: number | null;
  maximumElbowAngle: number;
  minimumElbowAngle: number;
  lastAngle: number;
  lastReliableAt: number;
  lastTimestamp: number;
  maximumAngularVelocity: number;
  reliableArmSamples: number;
  totalSamples: number;
  horizontalBodySamples: number;
  bodySamples: number;
  lastRoot: { x: number; y: number } | null;
}

const SIDES: ReadonlyArray<PoseSide> = ['left', 'right'];

/**
 * A permissive motion-window generator. It only locates coherent top-down-up elbow motion;
 * ML V1 and the deterministic safety layer decide whether the candidate is a valid rep.
 */
export class HybridCandidateGenerator {
  private readonly histories: Record<PoseSide, ArmHistory> = {
    left: this.newHistory(),
    right: this.newHistory(),
  };
  private active: ActiveCandidate | null = null;
  private lastFrameAt: number | null = null;
  private lastDiagnostics: HybridCandidateDiagnostics = {
    state: 'SEEKING_TOP',
    arm: null,
    durationMs: 0,
    elbowAngle: null,
    rejectionReason: null,
  };

  constructor(private readonly rules: HybridPushupRules = HYBRID_PUSHUP_RULES) {}

  reset(): void {
    this.histories.left = this.newHistory();
    this.histories.right = this.newHistory();
    this.active = null;
    this.lastFrameAt = null;
    this.lastDiagnostics = {
      state: 'SEEKING_TOP',
      arm: null,
      durationMs: 0,
      elbowAngle: null,
      rejectionReason: null,
    };
  }

  getDiagnostics(): HybridCandidateDiagnostics {
    return { ...this.lastDiagnostics };
  }

  update(pose: PoseResult, timestamp = pose.timestamp): HybridMotionCandidate | null {
    if (
      !Number.isFinite(timestamp) ||
      (this.lastFrameAt !== null && timestamp <= this.lastFrameAt)
    ) {
      return null;
    }
    const interrupted =
      this.lastFrameAt !== null && timestamp - this.lastFrameAt > this.rules.trackingGraceMs;
    this.lastFrameAt = timestamp;
    if (interrupted) {
      this.histories.left = this.newHistory();
      this.histories.right = this.newHistory();
      return this.reject('TRACKING_LOSS', timestamp, null);
    }
    const observations = {
      left: this.observe(pose, 'left'),
      right: this.observe(pose, 'right'),
    };
    if (!this.active) {
      for (const side of SIDES) {
        const previousAt = this.histories[side].previousAt;
        if (previousAt !== null && timestamp - previousAt > this.rules.trackingGraceMs) {
          this.histories[side] = this.newHistory();
        }
      }
      const start = this.chooseStart(observations, timestamp);
      if (start) this.active = start;
    }

    const candidate = this.active;
    if (!candidate) {
      this.lastDiagnostics = {
        state: 'SEEKING_TOP',
        arm: null,
        durationMs: 0,
        elbowAngle: null,
        rejectionReason: null,
      };
      this.updateHistories(observations, timestamp);
      return null;
    }

    let observation = observations[candidate.arm];
    if (timestamp - candidate.lastReliableAt > this.rules.trackingGraceMs) {
      this.histories.left = this.newHistory();
      this.histories.right = this.newHistory();
      return this.reject('TRACKING_LOSS', timestamp, null);
    }
    candidate.totalSamples += 1;
    // An isolated confident jump is missing evidence, not a new angle or a
    // reason to splice in the other arm. Recovery must occur within the grace.
    if (observation) {
      const elapsed = timestamp - candidate.lastTimestamp;
      const velocity =
        elapsed > 0 ? Math.abs(((observation.angle - candidate.lastAngle) * 1000) / elapsed) : 0;
      const displacement =
        observation.root && candidate.lastRoot
          ? Math.hypot(
              observation.root.x - candidate.lastRoot.x,
              observation.root.y - candidate.lastRoot.y,
            )
          : 0;
      if (
        velocity > this.rules.maximumAngularVelocity ||
        displacement > this.rules.maximumRootDisplacement
      ) {
        candidate.recoveryStartedAt = null;
        observation = null;
      } else if (candidate.recoveryStartedAt !== undefined) {
        candidate.recoveryStartedAt ??= timestamp;
        if (timestamp - candidate.recoveryStartedAt < this.rules.outlierRecoveryMs)
          observation = null;
        else candidate.recoveryStartedAt = undefined;
      }
    }
    if (observation) {
      const elapsed = timestamp - candidate.lastTimestamp;
      const velocity =
        elapsed > 0 ? ((observation.angle - candidate.lastAngle) * 1000) / elapsed : 0;
      candidate.maximumAngularVelocity = Math.max(
        candidate.maximumAngularVelocity,
        Math.abs(velocity),
      );
      candidate.reliableArmSamples += 1;
      candidate.lastReliableAt = timestamp;
      candidate.lastTimestamp = timestamp;
      candidate.lastAngle = observation.angle;
      candidate.maximumElbowAngle = Math.max(candidate.maximumElbowAngle, observation.angle);
      if (observation.angle < candidate.minimumElbowAngle) candidate.bottomAt = timestamp;
      candidate.minimumElbowAngle = Math.min(candidate.minimumElbowAngle, observation.angle);
      if (observation.torsoAngle !== null) {
        candidate.bodySamples += 1;
        if (observation.torsoAngle <= this.rules.maximumTorsoAngle) {
          candidate.horizontalBodySamples += 1;
        }
      }
      if (observation.root && candidate.lastRoot) {
        const rootDisplacement = Math.hypot(
          observation.root.x - candidate.lastRoot.x,
          observation.root.y - candidate.lastRoot.y,
        );
        if (rootDisplacement > this.rules.maximumRootDisplacement) {
          return this.reject('CAMERA_SHAKE', timestamp, observation.angle);
        }
      }
      if (observation.root) candidate.lastRoot = observation.root;

      if (Math.abs(velocity) > this.rules.maximumAngularVelocity) {
        return this.reject('IMPOSSIBLE_VELOCITY', timestamp, observation.angle);
      }
      if (
        candidate.state === 'DESCENDING' &&
        candidate.minimumElbowAngle <= this.rules.bottomishElbowAngle &&
        candidate.maximumElbowAngle - candidate.minimumElbowAngle >=
          this.rules.minimumExcursionDegrees
      ) {
        candidate.state = 'BOTTOM';
        candidate.bottomAt = timestamp;
      } else if (
        candidate.state === 'BOTTOM' &&
        observation.angle >= candidate.minimumElbowAngle + this.rules.reversalDegrees &&
        velocity >= this.rules.minimumDirectionalVelocity
      ) {
        candidate.state = 'ASCENDING';
      }

      if (
        candidate.state === 'DESCENDING' &&
        velocity >= this.rules.minimumDirectionalVelocity &&
        observation.angle >= candidate.maximumElbowAngle - this.rules.reversalDegrees
      ) {
        return this.reject('INCOMPLETE_MOTION', timestamp, observation.angle);
      }

      if (
        candidate.state === 'ASCENDING' &&
        candidate.bottomAt !== null &&
        timestamp - candidate.bottomAt >= this.rules.modelSampleIntervalMs &&
        observation.angle >= this.rules.returnTopElbowAngle &&
        observation.angle - candidate.minimumElbowAngle >= this.rules.minimumExcursionDegrees
      ) {
        const durationMs = timestamp - candidate.startedAt;
        if (durationMs < this.rules.minimumDurationMs) {
          return this.reject('DURATION', timestamp, observation.angle);
        }
        if (
          candidate.reliableArmSamples / candidate.totalSamples <
            this.rules.minimumReliableArmRatio ||
          candidate.bodySamples < this.rules.minimumBodySamples ||
          candidate.horizontalBodySamples / candidate.bodySamples <
            this.rules.minimumHorizontalBodyRatio
        ) {
          return this.reject('BODY_ORIENTATION', timestamp, observation.angle);
        }
        const completed: HybridMotionCandidate = {
          arm: candidate.arm,
          startedAt: candidate.startedAt,
          bottomAt: candidate.bottomAt,
          completedAt: timestamp,
          durationMs,
          maximumElbowAngle: candidate.maximumElbowAngle,
          minimumElbowAngle: candidate.minimumElbowAngle,
          returnElbowAngle: observation.angle,
          maximumAngularVelocity: candidate.maximumAngularVelocity,
          reliableArmSamples: candidate.reliableArmSamples,
          totalSamples: candidate.totalSamples,
          horizontalBodySamples: candidate.horizontalBodySamples,
          bodySamples: candidate.bodySamples,
        };
        this.active = null;
        this.histories[candidate.arm] = this.newHistory();
        this.lastDiagnostics = {
          state: 'SEEKING_TOP',
          arm: candidate.arm,
          durationMs,
          elbowAngle: observation.angle,
          rejectionReason: null,
        };
        this.updateHistories(observations, timestamp);
        return completed;
      }
    } else if (timestamp - candidate.lastReliableAt > this.rules.trackingGraceMs) {
      return this.reject('TRACKING_LOSS', timestamp, null);
    }

    if (timestamp - candidate.startedAt > this.rules.maximumDurationMs) {
      return this.reject('INCOMPLETE_MOTION', timestamp, observation?.angle ?? null);
    }
    this.lastDiagnostics = {
      state: candidate.state,
      arm: candidate.arm,
      durationMs: timestamp - candidate.startedAt,
      elbowAngle: observation?.angle ?? null,
      rejectionReason: null,
      trackingHeld: observation === null,
    };
    this.updateHistories(observations, timestamp);
    return null;
  }

  private chooseStart(
    observations: Record<PoseSide, ArmObservation | null>,
    timestamp: number,
  ): ActiveCandidate | null {
    const possible = SIDES.flatMap((side) => {
      const observation = observations[side];
      const history = this.histories[side];
      if (!observation || history.topAngle === null || history.topAt === null) return [];
      const elapsed = history.previousAt === null ? 0 : timestamp - history.previousAt;
      const velocity =
        elapsed > 0 && history.previousAngle !== null
          ? ((observation.angle - history.previousAngle) * 1000) / elapsed
          : 0;
      const descent = history.topAngle - observation.angle;
      if (
        descent < this.rules.reversalDegrees ||
        velocity > -this.rules.minimumDirectionalVelocity ||
        Math.abs(velocity) > this.rules.maximumAngularVelocity ||
        observation.torsoAngle === null ||
        observation.torsoAngle > this.rules.maximumTorsoAngle
      ) {
        return [];
      }
      return [{ side, observation, history, descent }];
    }).sort(
      (left, right) =>
        right.descent * right.observation.confidence - left.descent * left.observation.confidence,
    );
    const chosen = possible[0];
    if (!chosen || chosen.history.topAngle === null || chosen.history.topAt === null) return null;
    return {
      arm: chosen.side,
      state: 'DESCENDING',
      startedAt: chosen.history.topAt,
      bottomAt: null,
      maximumElbowAngle: chosen.history.topAngle,
      minimumElbowAngle: chosen.observation.angle,
      lastAngle: chosen.observation.angle,
      lastReliableAt: timestamp,
      lastTimestamp: timestamp,
      maximumAngularVelocity: 0,
      reliableArmSamples: 1,
      totalSamples: 1,
      horizontalBodySamples:
        chosen.observation.torsoAngle !== null &&
        chosen.observation.torsoAngle <= this.rules.maximumTorsoAngle
          ? 1
          : 0,
      bodySamples: chosen.observation.torsoAngle === null ? 0 : 1,
      lastRoot: chosen.observation.root,
    };
  }

  private updateHistories(
    observations: Record<PoseSide, ArmObservation | null>,
    timestamp: number,
  ): void {
    for (const side of SIDES) {
      const observation = observations[side];
      if (!observation) {
        const last = this.histories[side].previousAt;
        if (last !== null && timestamp - last > this.rules.trackingGraceMs) {
          this.histories[side] = this.newHistory();
        }
        continue;
      }
      const history = this.histories[side];
      history.previousAngle = observation.angle;
      history.previousAt = timestamp;
      if (
        observation.angle >= this.rules.topishElbowAngle &&
        (history.topAngle === null ||
          observation.angle >= history.topAngle - this.rules.reversalDegrees ||
          history.topAt === null ||
          timestamp - history.topAt > this.rules.maximumDurationMs)
      ) {
        history.topAngle = observation.angle;
        history.topAt = timestamp;
      }
    }
  }

  private observe(pose: PoseResult, side: PoseSide): ArmObservation | null {
    const names = landmarksForSide(side);
    const shoulder = pose.landmarks[names.shoulder];
    const elbow = pose.landmarks[names.elbow];
    const wrist = pose.landmarks[names.wrist];
    const rawHip = pose.landmarks[names.hip];
    const hip =
      rawHip &&
      Number.isFinite(rawHip.confidence) &&
      rawHip.confidence >= this.rules.armLandmarkConfidence &&
      Number.isFinite(rawHip.x) &&
      Number.isFinite(rawHip.y)
        ? rawHip
        : undefined;
    if (!shoulder || !elbow || !wrist) return null;
    const confidence = Math.min(shoulder.confidence, elbow.confidence, wrist.confidence);
    if (!Number.isFinite(confidence) || confidence < this.rules.armLandmarkConfidence) return null;
    if (!hybridPoseGeometry(pose, side, this.rules)) return null;
    const angle = calculateAngle(shoulder, elbow, wrist);
    if (angle === null) return null;
    return {
      angle,
      confidence,
      torsoAngle: hip ? this.lineAngleFromHorizontal(shoulder, hip) : null,
      root: hip ? { x: (shoulder.x + hip.x) / 2, y: (shoulder.y + hip.y) / 2 } : null,
    };
  }

  private reject(
    reason: HybridCandidateRejection,
    timestamp: number,
    elbowAngle: number | null,
  ): null {
    const active = this.active;
    this.active = null;
    this.histories.left = this.newHistory();
    this.histories.right = this.newHistory();
    this.lastDiagnostics = {
      state: 'SEEKING_TOP',
      arm: active?.arm ?? null,
      durationMs: active ? timestamp - active.startedAt : 0,
      elbowAngle,
      rejectionReason: reason,
    };
    return null;
  }

  private lineAngleFromHorizontal(start: PoseLandmark, end: PoseLandmark): number {
    return (Math.atan2(Math.abs(end.y - start.y), Math.abs(end.x - start.x)) * 180) / Math.PI;
  }

  private newHistory(): ArmHistory {
    return { previousAngle: null, previousAt: null, topAngle: null, topAt: null };
  }
}
