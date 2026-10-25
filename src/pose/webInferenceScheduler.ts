export class WebInferenceScheduler {
  readonly intervalMs: number;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private running = false;
  private visible = true;
  skippedFrames = 0;

  constructor(readonly requestedFps = 20) {
    this.intervalMs = 1_000 / Math.max(1, requestedFps);
  }

  tryStart(now: number): boolean {
    if (!this.visible || this.running || now - this.lastStartedAt < this.intervalMs) {
      this.skippedFrames += 1;
      return false;
    }
    this.running = true;
    this.lastStartedAt = now;
    return true;
  }

  complete(): void {
    this.running = false;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    // Visibility does not cancel the promise already using the model. Only its
    // completion may release the inference slot.
  }
  reset(): void {
    this.lastStartedAt = Number.NEGATIVE_INFINITY;
    this.running = false;
    this.skippedFrames = 0;
  }
}
