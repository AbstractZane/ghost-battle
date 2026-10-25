import {
  HybridCandidateGenerator,
  type HybridMotionCandidate,
} from '@/exercises/pushup/hybrid/HybridCandidateGenerator';
import { validateHybridCandidateSafety } from '@/exercises/pushup/hybrid/HybridSafetyValidator';
import { HYBRID_PUSHUP_RULES } from '@/exercises/pushup/pushupRules';
import type { PoseResult, PoseSide } from '@/pose/poseTypes';

import type { MlV1LocalValidator } from './mlV1Local';

export interface HybridMlV1Diagnostics {
  elbowAngle?: number | null;
  trackingHeld?: boolean;
  rejectionReason?: string | null;
  candidateState: string;
  candidateArm: PoseSide | null;
  candidateDurationMs: number;
  mlProbability: number | null;
  mlDecision: 'VALID' | 'INVALID' | 'WAITING';
  safetyDecision: string;
  finalRepCount: number;
}

interface PendingCandidate {
  candidate: HybridMotionCandidate;
  validateAt: number;
}

export class HybridMlV1Local {
  private readonly generator = new HybridCandidateGenerator();
  private poses: PoseResult[] = [];
  private pending: PendingCandidate | null = null;
  private scoring = false;
  private generation = 0;
  private diagnostics: HybridMlV1Diagnostics = {
    candidateState: 'SEEKING_TOP',
    candidateArm: null,
    candidateDurationMs: 0,
    mlProbability: null,
    mlDecision: 'WAITING',
    safetyDecision: 'WAITING',
    finalRepCount: 0,
  };

  constructor(
    private readonly validator: MlV1LocalValidator,
    private readonly onAccepted?: (
      candidate: HybridMotionCandidate,
      poses: ReadonlyArray<PoseResult>,
    ) => void,
    private readonly onDiagnostics?: (diagnostics: HybridMlV1Diagnostics) => void,
  ) {}

  getDiagnostics(): HybridMlV1Diagnostics {
    return { ...this.diagnostics };
  }

  reset(): void {
    this.generation += 1;
    this.generator.reset();
    this.poses = [];
    this.pending = null;
    this.scoring = false;
    this.diagnostics = {
      candidateState: 'SEEKING_TOP',
      candidateArm: null,
      candidateDurationMs: 0,
      mlProbability: null,
      mlDecision: 'WAITING',
      safetyDecision: 'WAITING',
      finalRepCount: 0,
    };
  }

  async addPose(pose: PoseResult): Promise<HybridMlV1Diagnostics> {
    this.poses.push(pose);
    this.poses = this.poses.filter(
      (item) => pose.timestamp - item.timestamp <= HYBRID_PUSHUP_RULES.maximumDurationMs + 2_000,
    );
    const completed = this.generator.update(pose, pose.timestamp);
    if (completed && !this.pending) {
      this.pending = {
        candidate: completed,
        validateAt: completed.completedAt + HYBRID_PUSHUP_RULES.contextAfterMs,
      };
      this.diagnostics = {
        ...this.diagnostics,
        candidateState: 'VALIDATING',
        candidateArm: completed.arm,
        candidateDurationMs: completed.durationMs,
        elbowAngle: completed.returnElbowAngle,
        trackingHeld: false,
        rejectionReason: null,
        mlProbability: null,
        mlDecision: 'WAITING',
        safetyDecision: 'WAITING',
      };
    } else if (!this.pending) {
      const current = this.generator.getDiagnostics();
      this.diagnostics = {
        ...this.diagnostics,
        candidateState: current.state,
        candidateArm: current.arm,
        candidateDurationMs: current.durationMs,
        elbowAngle: current.elbowAngle,
        trackingHeld: current.trackingHeld ?? false,
        rejectionReason: current.rejectionReason,
      };
    }
    this.onDiagnostics?.(this.getDiagnostics());
    if (!this.pending || pose.timestamp < this.pending.validateAt || this.scoring) {
      return { ...this.diagnostics };
    }

    this.scoring = true;
    const generation = this.generation;
    const pending = this.pending;
    try {
      const sampled = this.modelWindow(pending.candidate, pose.timestamp);
      const ml = await this.validator.scorePoseWindow(sampled);
      if (generation !== this.generation) return { ...this.diagnostics };
      const candidatePoses = this.poses.filter(
        (item) =>
          item.timestamp >= pending.candidate.startedAt &&
          item.timestamp <= pending.candidate.completedAt,
      );
      const safety =
        ml.decision === 'VALID'
          ? validateHybridCandidateSafety(pending.candidate, candidatePoses)
          : null;
      if (safety?.accepted) {
        this.diagnostics.finalRepCount += 1;
        this.onAccepted?.(pending.candidate, candidatePoses);
      }
      this.diagnostics = {
        ...this.diagnostics,
        candidateState: safety?.accepted ? 'ACCEPTED' : 'REJECTED',
        candidateArm: pending.candidate.arm,
        candidateDurationMs: pending.candidate.durationMs,
        mlProbability: ml.validProbability,
        mlDecision: ml.decision,
        safetyDecision:
          ml.decision !== 'VALID'
            ? 'NOT RUN · ML REJECTED'
            : safety?.accepted
              ? 'ACCEPTED'
              : `REJECTED · ${safety?.reason ?? 'UNKNOWN'}`,
      };
      this.pending = null;
      this.onDiagnostics?.(this.getDiagnostics());
      return { ...this.diagnostics };
    } finally {
      if (generation === this.generation) this.scoring = false;
    }
  }

  private modelWindow(candidate: HybridMotionCandidate, finalTimestamp: number): PoseResult[] {
    const interval = HYBRID_PUSHUP_RULES.modelSampleIntervalMs;
    const span = (48 - 1) * interval;
    const first = this.poses[0]?.timestamp ?? candidate.startedAt;
    const end = Math.min(
      finalTimestamp,
      Math.max(candidate.completedAt + HYBRID_PUSHUP_RULES.contextAfterMs, first + span),
    );
    const start = Math.max(
      first,
      Math.min(candidate.startedAt - HYBRID_PUSHUP_RULES.contextBeforeMs, end - span),
    );
    const sampled: PoseResult[] = [];
    let sourceIndex = 0;
    for (let target = start; target <= end; target += interval) {
      while (
        sourceIndex + 1 < this.poses.length &&
        Math.abs((this.poses[sourceIndex + 1]?.timestamp ?? target) - target) <=
          Math.abs((this.poses[sourceIndex]?.timestamp ?? target) - target)
      ) {
        sourceIndex += 1;
      }
      const source = this.poses[sourceIndex];
      if (source) sampled.push({ ...source, timestamp: sampled.length * interval });
    }
    return sampled;
  }
}
