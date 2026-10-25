import { PoseEngineV3 } from './poseEngineV3';
import type { PoseLandmarks, PoseResult } from './poseTypes';

interface PoseTrackerOptions {
  stillAlpha: number;
  motionAlpha: number;
  glitchDistance: number;
  confidenceFloor: number;
  graceMs: number;
}

const DEFAULT_OPTIONS: Readonly<PoseTrackerOptions> = {
  stillAlpha: 0.35,
  motionAlpha: 0.7,
  glitchDistance: 0.22,
  confidenceFloor: 0.18,
  graceMs: 600,
};

/** Temporal tracker for canonical pose coordinates. Never consumes display-projected points. */
export class PoseTracker {
  private readonly engine: PoseEngineV3;
  private history: PoseLandmarks[] = [];

  constructor(private options: PoseTrackerOptions = { ...DEFAULT_OPTIONS }) {
    this.engine = new PoseEngineV3(this.engineOptions());
  }

  setAlpha(alpha: number): void {
    this.options = { ...this.options, stillAlpha: Math.max(0.05, Math.min(1, alpha)) };
    this.engine.setOptions(this.engineOptions());
  }

  setOptions(options: Partial<PoseTrackerOptions>): void {
    this.options = { ...this.options, ...options };
    this.engine.setOptions(this.engineOptions());
  }

  reset(): void {
    this.engine.reset();
    this.history = [];
  }

  smooth(result: PoseResult): PoseResult {
    const frame = this.engine.update(result);
    const tracked = frame?.displayPose ?? result;
    const landmarks = tracked.landmarks;
    this.history = [...this.history.slice(-7), landmarks];
    return tracked;
  }

  getHistory(): ReadonlyArray<PoseLandmarks> {
    return this.history;
  }

  private engineOptions() {
    return {
      confidenceFloor: this.options.confidenceFloor,
      displayStillAlpha: this.options.stillAlpha,
      displayMotionAlpha: this.options.motionAlpha,
      outlierDistance: this.options.glitchDistance,
      signalGraceMs: this.options.graceMs,
    };
  }
}

/** @deprecated Use PoseTracker; retained for source compatibility. */
export class PoseSmoother extends PoseTracker {}
