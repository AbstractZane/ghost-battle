import { PoseEngineV3 } from '@/pose/poseEngineV3';
import { PushupDetector } from '@/exercises/pushup/PushupDetector';
import type { PoseResult } from '@/pose/poseTypes';
import { motionFrame, type GhostAnalysisResult } from './ghostMotion';

/** Imported video uses its presentation time, not analysis speed or wall-clock time. */
export class GhostAnalysisAccumulator {
  private engine = new PoseEngineV3();
  private detector = new PushupDetector();
  private lastAt = -1;
  private gapStart: number | null = null;
  readonly result: GhostAnalysisResult;
  constructor(durationMs: number, aspectRatio: number) {
    this.result = {
      version: 1,
      motion: { version: 1, durationMs, aspectRatio, frames: [] },
      repTimesMs: [],
      gaps: [],
      reviewed: false,
      method: 'detector',
    };
  }
  add(pose: PoseResult | null, atMs: number) {
    atMs = Math.round(atMs);
    if (
      !Number.isFinite(atMs) ||
      atMs <= this.lastAt ||
      atMs < 0 ||
      atMs > this.result.motion.durationMs ||
      this.result.motion.frames.length >= 4600
    )
      return;
    this.lastAt = atMs;
    const frame = pose ? this.engine.update({ ...pose, timestamp: atMs + 1 }) : null;
    const usable = frame && frame.detectorPose.tracking?.signalQuality !== 'LOST';
    if (!usable) {
      this.detector.setPaused(true);
      this.detector.setPaused(false);
      if (this.gapStart === null) this.gapStart = atMs;
    } else {
      if (this.gapStart !== null) {
        this.result.gaps.push({ fromMs: this.gapStart, toMs: atMs });
        this.gapStart = null;
      }
      const detection = this.detector.processPose(frame.detectorPose);
      if (detection.rep && atMs > 0) this.result.repTimesMs.push(atMs);
    }
    this.result.motion.frames.push(motionFrame(usable ? frame.displayPose : null, atMs));
  }
  finish(): GhostAnalysisResult {
    if (this.gapStart !== null) {
      this.result.gaps.push({ fromMs: this.gapStart, toMs: this.result.motion.durationMs });
      this.gapStart = null;
    }
    return this.result;
  }
}
