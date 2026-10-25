export type PushupContextState =
  'NOT_PUSHUP' | 'ENTERING_PUSHUP' | 'PUSHUP' | 'UNCERTAIN' | 'EXITING_PUSHUP';

export interface PushupContextOptions {
  enterConfirmationMs: number;
  degradedGraceMs: number;
  exitConfirmationMs: number;
}

export class PushupContextDetector {
  private state: PushupContextState = 'NOT_PUSHUP';
  private stateSince = 0;

  constructor(private options: PushupContextOptions) {}

  setOptions(options: PushupContextOptions): void {
    this.options = options;
  }

  reset(): void {
    this.state = 'NOT_PUSHUP';
    this.stateSince = 0;
  }

  update(plausible: boolean, fresh: boolean, timestamp: number): PushupContextState {
    switch (this.state) {
      case 'NOT_PUSHUP':
        if (plausible && fresh) this.transition('ENTERING_PUSHUP', timestamp);
        break;
      case 'ENTERING_PUSHUP':
        if (!plausible) this.transition('NOT_PUSHUP', timestamp);
        else if (fresh && timestamp - this.stateSince >= this.options.enterConfirmationMs)
          this.transition('PUSHUP', timestamp);
        break;
      case 'PUSHUP':
        if (!plausible || !fresh) this.transition('UNCERTAIN', timestamp);
        break;
      case 'UNCERTAIN':
        if (plausible && fresh) this.transition('PUSHUP', timestamp);
        else if (timestamp - this.stateSince >= this.options.degradedGraceMs)
          this.transition('EXITING_PUSHUP', timestamp);
        break;
      case 'EXITING_PUSHUP':
        if (plausible && fresh) this.transition('PUSHUP', timestamp);
        else if (timestamp - this.stateSince >= this.options.exitConfirmationMs)
          this.transition('NOT_PUSHUP', timestamp);
        break;
    }
    return this.state;
  }

  getState(): PushupContextState {
    return this.state;
  }

  private transition(next: PushupContextState, timestamp: number): void {
    this.state = next;
    this.stateSince = timestamp;
  }
}
