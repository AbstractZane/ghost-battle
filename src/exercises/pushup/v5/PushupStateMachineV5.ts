import type { PushupRules } from '@/exercises/pushup/pushupRules';
import type { RejectedRepReason } from '@/exercises/pushup/pushupTypes';

import type { PushupPhaseV5 } from './v5Types';

export interface PushupStateInputV5 {
  timestamp: number;
  elbowAngle?: number;
  elbowVelocity?: number;
  reliable: boolean;
  ready: boolean;
  stableBody: boolean;
  sideChanged: boolean;
}

export interface PushupStateUpdateV5 {
  phase: PushupPhaseV5;
  candidateActive: boolean;
  candidateStarted: boolean;
  candidateCompleted: boolean;
  candidateRejected: boolean;
  rejectionReason?: RejectedRepReason;
  startedAt?: number;
  minimumElbowAngle?: number;
  maximumElbowAngle?: number;
  transitionAccepted: boolean;
}

export interface PushupStateMachineDiagnosticsV5 {
  phase: PushupPhaseV5;
  pendingTransition: Exclude<PushupPhaseV5, 'NOT_READY' | 'TOP_CONFIRMED'> | null;
  pendingSince: number | null;
  pendingElapsedMs: number;
  candidateStartedAt: number | null;
  candidateElapsedMs: number;
}

type PendingTransition = Exclude<PushupPhaseV5, 'NOT_READY' | 'TOP_CONFIRMED'>;

/** A coherent top → descent → bottom → ascent → confirmed-top recognizer. */
export class PushupStateMachineV5 {
  private phase: PushupPhaseV5 = 'NOT_READY';
  private pending: PendingTransition | null = null;
  private pendingSince = 0;
  private candidateStartedAt?: number;
  private minimumElbowAngle?: number;
  private maximumElbowAngle?: number;
  private impossibleMotion = false;
  private topEvidenceSince?: number;
  private bottomEvidenceSince?: number;
  private unreliableSince?: number;

  constructor(private readonly rules: PushupRules) {}

  reset(): void {
    this.phase = 'NOT_READY';
    this.pending = null;
    this.topEvidenceSince = undefined;
    this.bottomEvidenceSince = undefined;
    this.unreliableSince = undefined;
    this.clearCandidate();
  }

  getPhase(): PushupPhaseV5 {
    return this.phase;
  }

  getDiagnostics(timestamp: number): PushupStateMachineDiagnosticsV5 {
    return {
      phase: this.phase,
      pendingTransition: this.pending,
      pendingSince: this.pending ? this.pendingSince : null,
      pendingElapsedMs: this.pending ? Math.max(0, timestamp - this.pendingSince) : 0,
      candidateStartedAt: this.candidateStartedAt ?? null,
      candidateElapsedMs:
        this.candidateStartedAt === undefined
          ? 0
          : Math.max(0, timestamp - this.candidateStartedAt),
    };
  }

  update(input: PushupStateInputV5): PushupStateUpdateV5 {
    if (input.sideChanged && this.candidateStartedAt !== undefined) {
      return this.reject('SIDE_SWITCH_ARTIFACT');
    }
    this.recordThresholdEvidence(input);
    if (!input.ready || !input.stableBody) {
      if (this.candidateStartedAt !== undefined && !input.ready) {
        return this.reject(input.stableBody ? 'TRACKING_LOST' : 'POSE_UNSTABLE');
      }
      if (this.phase === 'NOT_READY') return this.snapshot();
    }
    if (!input.reliable || input.elbowAngle === undefined) {
      this.unreliableSince ??= input.timestamp;
      if (
        this.candidateStartedAt !== undefined &&
        input.timestamp - this.unreliableSince > this.rules.v5TrackingLossResetMs
      ) {
        return this.reject('TRACKING_LOST');
      }
      return this.snapshot();
    }
    this.unreliableSince = undefined;

    const angle = input.elbowAngle;
    const velocity = input.elbowVelocity ?? 0;
    if (Math.abs(velocity) > this.rules.v5MaximumAngularVelocity) this.impossibleMotion = true;
    this.recordExtrema(angle);

    switch (this.phase) {
      case 'NOT_READY':
        if (input.ready && angle >= this.rules.upElbowAngle) {
          if (
            this.confirm(
              'TOP',
              input.timestamp,
              this.rules.v5TopConfirmationMs,
              this.topEvidenceSince,
            )
          ) {
            return this.transition('TOP');
          }
        } else {
          this.pending = null;
        }
        break;
      case 'TOP':
      case 'TOP_CONFIRMED':
        if (
          angle <= this.rules.leaveUpElbowAngle &&
          velocity <= -this.rules.minimumMotionVelocity
        ) {
          if (this.confirm('DESCENDING', input.timestamp, this.rules.v5DescentConfirmationMs)) {
            this.candidateStartedAt = input.timestamp;
            this.minimumElbowAngle = angle;
            this.maximumElbowAngle = angle;
            this.impossibleMotion ||= Math.abs(velocity) > this.rules.v5MaximumAngularVelocity;
            if (
              this.bottomEvidenceSince !== undefined &&
              input.timestamp - this.bottomEvidenceSince >= this.rules.v5BottomConfirmationMs
            ) {
              return this.transition('BOTTOM', { candidateStarted: true });
            }
            return this.transition('DESCENDING', { candidateStarted: true });
          }
        } else {
          this.pending = null;
          if (this.phase === 'TOP_CONFIRMED') this.phase = 'TOP';
        }
        break;
      case 'DESCENDING':
        // At web-camera cadence a real bottom can be sampled once below the
        // enter threshold and once while already beginning to rise. Keep that
        // evidence through the existing leave-down hysteresis instead of
        // requiring two identical below-90° samples.
        if (
          angle <= this.rules.downElbowAngle ||
          (this.bottomEvidenceSince !== undefined && angle <= this.rules.leaveDownElbowAngle)
        ) {
          if (this.confirm('BOTTOM', input.timestamp, this.rules.v5BottomConfirmationMs)) {
            return this.transition('BOTTOM');
          }
        } else if (angle >= this.rules.upElbowAngle) {
          return this.reject('INSUFFICIENT_DEPTH', 'TOP');
        } else {
          this.pending = null;
        }
        break;
      case 'BOTTOM':
        if (
          angle >= this.rules.leaveDownElbowAngle &&
          velocity >= this.rules.minimumMotionVelocity
        ) {
          if (this.confirm('ASCENDING', input.timestamp, this.rules.v5AscentConfirmationMs)) {
            return this.transition('ASCENDING');
          }
        } else {
          this.pending = null;
        }
        break;
      case 'ASCENDING':
        if (angle >= this.rules.upElbowAngle) {
          if (this.confirm('TOP', input.timestamp, this.rules.v5ReturnTopConfirmationMs)) {
            const duration = input.timestamp - (this.candidateStartedAt ?? input.timestamp);
            if (this.impossibleMotion) return this.reject('IMPOSSIBLE_MOTION', 'TOP');
            if (duration < this.rules.v5MinimumRepDurationMs) {
              return this.reject('MOVEMENT_TOO_FAST', 'TOP');
            }
            if (duration > this.rules.v5MaximumRepDurationMs) {
              return this.reject('INVALID_SEQUENCE', 'TOP');
            }
            const completed = {
              startedAt: this.candidateStartedAt,
              minimumElbowAngle: this.minimumElbowAngle,
              maximumElbowAngle: this.maximumElbowAngle,
            };
            this.phase = 'TOP_CONFIRMED';
            this.pending = null;
            this.clearCandidate();
            return this.snapshot({
              ...completed,
              candidateCompleted: true,
              transitionAccepted: true,
            });
          }
        } else if (angle <= this.rules.downElbowAngle) {
          return this.reject('INCOMPLETE_EXTENSION', 'BOTTOM');
        } else {
          this.pending = null;
        }
        break;
    }
    return this.snapshot();
  }

  private confirm(
    next: PendingTransition,
    timestamp: number,
    duration: number,
    evidenceSince?: number,
  ): boolean {
    if (this.pending !== next) {
      this.pending = next;
      this.pendingSince = Math.min(timestamp, evidenceSince ?? timestamp);
      return timestamp - this.pendingSince >= duration;
    }
    if (evidenceSince !== undefined) {
      this.pendingSince = Math.min(this.pendingSince, evidenceSince);
    }
    return timestamp - this.pendingSince >= duration;
  }

  private recordThresholdEvidence(input: PushupStateInputV5): void {
    const angle = input.elbowAngle;
    if (!input.reliable || angle === undefined || input.sideChanged) {
      this.topEvidenceSince = undefined;
      this.bottomEvidenceSince = undefined;
      return;
    }

    if (input.stableBody && angle >= this.rules.upElbowAngle) {
      this.topEvidenceSince ??= input.timestamp;
    } else {
      this.topEvidenceSince = undefined;
    }

    if (
      (input.ready || this.candidateStartedAt !== undefined || this.phase === 'TOP') &&
      angle <= this.rules.downElbowAngle
    ) {
      this.bottomEvidenceSince ??= input.timestamp;
    } else if (angle > this.rules.leaveDownElbowAngle) {
      this.bottomEvidenceSince = undefined;
    }
  }

  private transition(
    phase: PushupPhaseV5,
    events: Partial<PushupStateUpdateV5> = {},
  ): PushupStateUpdateV5 {
    this.phase = phase;
    this.pending = null;
    return this.snapshot({ ...events, transitionAccepted: true });
  }

  private reject(
    rejectionReason: RejectedRepReason,
    next: PushupPhaseV5 = 'NOT_READY',
  ): PushupStateUpdateV5 {
    this.phase = next;
    this.pending = null;
    const result = this.snapshot({
      candidateRejected: true,
      rejectionReason,
      transitionAccepted: true,
    });
    this.clearCandidate();
    return result;
  }

  private recordExtrema(angle: number): void {
    if (this.candidateStartedAt === undefined) return;
    this.minimumElbowAngle = Math.min(this.minimumElbowAngle ?? angle, angle);
    this.maximumElbowAngle = Math.max(this.maximumElbowAngle ?? angle, angle);
  }

  private clearCandidate(): void {
    this.candidateStartedAt = undefined;
    this.minimumElbowAngle = undefined;
    this.maximumElbowAngle = undefined;
    this.impossibleMotion = false;
    this.bottomEvidenceSince = undefined;
    this.unreliableSince = undefined;
  }

  private snapshot(events: Partial<PushupStateUpdateV5> = {}): PushupStateUpdateV5 {
    return {
      phase: this.phase,
      candidateActive: this.candidateStartedAt !== undefined,
      candidateStarted: false,
      candidateCompleted: false,
      candidateRejected: false,
      startedAt: this.candidateStartedAt,
      minimumElbowAngle: this.minimumElbowAngle,
      maximumElbowAngle: this.maximumElbowAngle,
      transitionAccepted: false,
      ...events,
    };
  }
}
