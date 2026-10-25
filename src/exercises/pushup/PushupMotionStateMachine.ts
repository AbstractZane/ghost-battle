import type { PushupRules } from './pushupRules';
import type { PushupState } from './pushupTypes';

export type PushupCompletionMode = 'SAMPLED_TOP' | 'PEAK_REVERSAL';

export interface PushupMotionInput {
  timestamp: number;
  elbowAngle: number;
  elbowVelocity?: number;
  reliable: boolean;
}

export interface PushupMotionUpdate {
  phase: PushupState;
  requestedTransition?: PushupState;
  transitionAccepted: boolean;
  candidateStarted: boolean;
  candidateCancelled: boolean;
  candidateCompleted: boolean;
  completionMode?: PushupCompletionMode;
  candidateActive: boolean;
  bottomConfirmed: boolean;
  minimumElbowAngle?: number;
  maximumElbowAngle?: number;
  recentPeakAngle?: number;
  recentPeakTimestamp?: number;
}

/** Pure, deterministic arm-cycle recognizer. Context and exercise eligibility live above it. */
export class PushupMotionStateMachine {
  private phase: PushupState = 'NOT_READY';
  private pendingTransition: PushupState | null = null;
  private pendingSince = 0;
  private candidateActive = false;
  private bottomConfirmed = false;
  private minimumElbowAngle?: number;
  private maximumElbowAngle?: number;
  private recentPeakAngle?: number;
  private recentPeakTimestamp?: number;

  constructor(private rules: PushupRules) {}

  setRules(rules: PushupRules): void {
    this.rules = rules;
  }

  reset(): void {
    this.phase = 'NOT_READY';
    this.pendingTransition = null;
    this.candidateActive = false;
    this.bottomConfirmed = false;
    this.minimumElbowAngle = undefined;
    this.maximumElbowAngle = undefined;
    this.recentPeakAngle = undefined;
    this.recentPeakTimestamp = undefined;
  }

  armAtTop(elbowAngle: number, timestamp: number): void {
    this.phase = 'UP';
    this.pendingTransition = null;
    this.candidateActive = false;
    this.bottomConfirmed = false;
    this.minimumElbowAngle = elbowAngle;
    this.maximumElbowAngle = elbowAngle;
    this.recentPeakAngle = elbowAngle;
    this.recentPeakTimestamp = timestamp;
  }

  getSnapshot(): PushupMotionUpdate {
    return this.snapshot(false, false, false, false);
  }

  update(input: PushupMotionInput): PushupMotionUpdate {
    if (!input.reliable || this.phase === 'NOT_READY') {
      return this.snapshot(false, false, false, false);
    }

    const { elbowAngle, elbowVelocity = 0, timestamp } = input;
    this.recordExtrema(elbowAngle, timestamp);
    let requestedTransition: PushupState | undefined;
    let candidateStarted = false;
    let candidateCancelled = false;
    let candidateCompleted = false;
    let completionMode: PushupCompletionMode | undefined;
    let transitionAccepted = false;

    switch (this.phase) {
      case 'UP':
        if (
          elbowAngle <= this.rules.leaveUpElbowAngle &&
          elbowVelocity <= -this.rules.minimumMotionVelocity
        ) {
          requestedTransition = 'DESCENDING';
          this.commit('DESCENDING');
          transitionAccepted = true;
          this.beginCandidate(elbowAngle, timestamp);
          candidateStarted = true;
          if (
            elbowAngle <= this.rules.downElbowAngle &&
            this.confirm('DOWN', timestamp, elbowAngle)
          ) {
            this.bottomConfirmed = true;
          }
        }
        break;
      case 'DESCENDING':
        if (elbowAngle <= this.rules.downElbowAngle) {
          requestedTransition = 'DOWN';
          if (this.confirm(requestedTransition, timestamp, elbowAngle)) {
            transitionAccepted = true;
            this.bottomConfirmed = true;
          }
        } else if (elbowAngle >= this.rules.upElbowAngle) {
          requestedTransition = 'UP';
          this.commit('UP');
          transitionAccepted = true;
          this.clearCandidate();
          candidateCancelled = true;
        } else {
          this.pendingTransition = null;
        }
        break;
      case 'DOWN':
        if (
          elbowAngle >= this.rules.leaveDownElbowAngle &&
          elbowVelocity >= this.rules.minimumMotionVelocity
        ) {
          requestedTransition = 'ASCENDING';
          this.commit('ASCENDING');
          transitionAccepted = true;
          this.recentPeakAngle = elbowAngle;
          this.recentPeakTimestamp = timestamp;
          if (elbowAngle >= this.rules.upElbowAngle) {
            this.commit('UP');
            candidateCompleted = true;
            completionMode = 'SAMPLED_TOP';
            this.clearCandidate();
          }
        }
        break;
      case 'ASCENDING': {
        if (elbowAngle >= this.rules.upElbowAngle) {
          requestedTransition = 'UP';
          this.commit('UP');
          transitionAccepted = true;
          candidateCompleted = true;
          completionMode = 'SAMPLED_TOP';
          this.clearCandidate();
          break;
        }
        const recentPeak = this.recentPeakAngle ?? elbowAngle;
        const recentPeakAt = this.recentPeakTimestamp ?? timestamp;
        const reversedNearTop =
          this.bottomConfirmed &&
          recentPeak >= this.rules.nearTopElbowAngle &&
          elbowVelocity <= -this.rules.topReversalVelocity &&
          timestamp - recentPeakAt <= this.rules.topReversalWindowMs;
        if (reversedNearTop) {
          requestedTransition = 'UP';
          this.commit('UP');
          transitionAccepted = true;
          candidateCompleted = true;
          completionMode = 'PEAK_REVERSAL';
          this.clearCandidate();
        } else if (elbowAngle <= this.rules.downElbowAngle) {
          requestedTransition = 'DOWN';
          this.commit('DOWN');
          transitionAccepted = true;
        }
        break;
      }
    }

    return this.snapshot(
      candidateStarted,
      candidateCancelled,
      candidateCompleted,
      transitionAccepted,
      requestedTransition,
      completionMode,
    );
  }

  private beginCandidate(elbowAngle: number, timestamp: number): void {
    this.candidateActive = true;
    this.bottomConfirmed = false;
    this.minimumElbowAngle = elbowAngle;
    this.maximumElbowAngle = elbowAngle;
    this.recentPeakAngle = undefined;
    this.recentPeakTimestamp = timestamp;
  }

  private clearCandidate(): void {
    this.candidateActive = false;
    this.bottomConfirmed = false;
  }

  private recordExtrema(elbowAngle: number, timestamp: number): void {
    if (!this.candidateActive) return;
    this.minimumElbowAngle = Math.min(this.minimumElbowAngle ?? elbowAngle, elbowAngle);
    this.maximumElbowAngle = Math.max(this.maximumElbowAngle ?? elbowAngle, elbowAngle);
    if (this.phase === 'ASCENDING' && elbowAngle >= (this.recentPeakAngle ?? -Infinity)) {
      this.recentPeakAngle = elbowAngle;
      this.recentPeakTimestamp = timestamp;
    }
  }

  private confirm(next: PushupState, timestamp: number, elbowAngle: number): boolean {
    const strongBottom = next === 'DOWN' && elbowAngle <= this.rules.strongBottomAngle;
    const confirmationMs = next === 'DOWN' ? this.rules.bottomConfirmationMs : 0;
    if (strongBottom || confirmationMs === 0) {
      this.commit(next);
      return true;
    }
    if (this.pendingTransition !== next) {
      this.pendingTransition = next;
      this.pendingSince = timestamp;
      return false;
    }
    if (timestamp - this.pendingSince < confirmationMs) return false;
    this.commit(next);
    return true;
  }

  private commit(next: PushupState): void {
    this.phase = next;
    this.pendingTransition = null;
  }

  private snapshot(
    candidateStarted: boolean,
    candidateCancelled: boolean,
    candidateCompleted: boolean,
    transitionAccepted: boolean,
    requestedTransition?: PushupState,
    completionMode?: PushupCompletionMode,
  ): PushupMotionUpdate {
    return {
      phase: this.phase,
      requestedTransition,
      transitionAccepted,
      candidateStarted,
      candidateCancelled,
      candidateCompleted,
      completionMode,
      candidateActive: this.candidateActive,
      bottomConfirmed: this.bottomConfirmed,
      minimumElbowAngle: this.minimumElbowAngle,
      maximumElbowAngle: this.maximumElbowAngle,
      recentPeakAngle: this.recentPeakAngle,
      recentPeakTimestamp: this.recentPeakTimestamp,
    };
  }
}
