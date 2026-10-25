export const soundCueDetails = {
  rpgArrivalVerdant: { duration: 1400, gain: 0.55, lane: 'event' },
  rpgArrivalEmber: { duration: 1400, gain: 0.55, lane: 'event' },
  rpgArrivalAstral: { duration: 1400, gain: 0.55, lane: 'event' },
  rpgArrivalTidal: { duration: 1400, gain: 0.55, lane: 'event' },
  rpgArrivalClockwork: { duration: 1400, gain: 0.55, lane: 'event' },
  rpgVictoryVerdant: { duration: 2100, gain: 0.65, lane: 'event' },
  rpgVictoryEmber: { duration: 2100, gain: 0.65, lane: 'event' },
  rpgVictoryAstral: { duration: 2100, gain: 0.65, lane: 'event' },
  rpgVictoryTidal: { duration: 2100, gain: 0.65, lane: 'event' },
  rpgVictoryClockwork: { duration: 2100, gain: 0.65, lane: 'event' },
  rpgChest: { duration: 1100, gain: 0.65, lane: 'event' },
  rpgForge: { duration: 1400, gain: 0.65, lane: 'event' },
  rpgLeaf: { duration: 480, gain: 0.65, lane: 'ui' },
  rpgFlame: { duration: 480, gain: 0.65, lane: 'ui' },
  rpgPrism: { duration: 480, gain: 0.6, lane: 'ui' },
  rpgWave: { duration: 480, gain: 0.65, lane: 'ui' },
  rpgBolt: { duration: 480, gain: 0.6, lane: 'ui' },
  press: { duration: 90, gain: 0.45, lane: 'ui' },
  navigate: { duration: 140, gain: 0.5, lane: 'ui' },
  toggle: { duration: 110, gain: 0.5, lane: 'ui' },
  confirm: { duration: 480, gain: 0.65, lane: 'event' },
  error: { duration: 260, gain: 0.55, lane: 'event' },
  notification: { duration: 360, gain: 0.45, lane: 'ui' },
  queue: { duration: 500, gain: 0.65, lane: 'event' },
  matchFound: { duration: 850, gain: 0.85, lane: 'event' },
  ready: { duration: 280, gain: 0.6, lane: 'event' },
  countdown: { duration: 150, gain: 0.55, lane: 'ui' },
  go: { duration: 600, gain: 0.85, lane: 'event' },
  finish: { duration: 700, gain: 0.7, lane: 'event' },
  win: { duration: 1100, gain: 0.8, lane: 'event' },
  loss: { duration: 700, gain: 0.6, lane: 'event' },
  draw: { duration: 700, gain: 0.65, lane: 'event' },
  achievement: { duration: 1100, gain: 0.75, lane: 'event' },
  rankUp: { duration: 1300, gain: 0.8, lane: 'event' },
  purchase: { duration: 800, gain: 0.7, lane: 'event' },
  gemTick: { duration: 160, gain: 0.5, lane: 'ui' },
  gemPurchase: { duration: 950, gain: 0.7, lane: 'event' },
  equip: { duration: 420, gain: 0.6, lane: 'event' },
  disconnect: { duration: 420, gain: 0.65, lane: 'event' },
  reconnect: { duration: 480, gain: 0.65, lane: 'event' },
  entranceClash: { duration: 3000, gain: 0.7, lane: 'event' },
  entranceDoor: { duration: 3000, gain: 0.75, lane: 'event' },
  entranceBlossom: { duration: 3000, gain: 0.65, lane: 'event' },
  entrancePixel: { duration: 3000, gain: 0.65, lane: 'event' },
  entranceIron: { duration: 3000, gain: 0.7, lane: 'event' },
  entranceBronze: { duration: 3000, gain: 0.65, lane: 'event' },
  entranceSilver: { duration: 3000, gain: 0.6, lane: 'event' },
  entranceGold: { duration: 3000, gain: 0.65, lane: 'event' },
  entrancePlatinum: { duration: 3000, gain: 0.65, lane: 'event' },
  entranceEmerald: { duration: 3000, gain: 0.6, lane: 'event' },
  entranceDiamond: { duration: 3000, gain: 0.65, lane: 'event' },
  entranceMaster: { duration: 3000, gain: 0.65, lane: 'event' },
  entranceForgeMaster: { duration: 3000, gain: 0.7, lane: 'event' },
  entranceInferno: { duration: 3000, gain: 0.7, lane: 'event' },
} as const;
export type SoundCue = keyof typeof soundCueDetails;
export type SoundLane = 'ui' | 'event';
export interface SoundTransport {
  unlock(): void;
  play(cue: SoundCue, volume: number, lane: SoundLane): void;
  stop(lane?: SoundLane): void;
  dispose(): void;
}
export interface CueOptions {
  eventKey?: string;
  scope?: string;
  speech?: boolean;
}
const priority = (cue: SoundCue): number =>
  ['go', 'win', 'loss', 'draw', 'rankUp', 'disconnect'].includes(cue) ||
  cue.startsWith('rpgVictory')
    ? 5
    : cue.startsWith('entrance') || cue.startsWith('rpgArrival')
      ? 4
      : cue === 'achievement'
        ? 2
        : 3;

/** Consumes muted/stale events; never queues sounds for later playback. */
export class SoundEffectsEngine {
  private enabled = true;
  private volume = 0.35;
  private foreground = true;
  private seen = new Set<string>();
  private activeScopes: Partial<Record<SoundLane, string>> = {};
  private eventUntil = 0;
  private eventPriority = 0;
  private lastUiAt = -Infinity;
  constructor(
    private transport: SoundTransport,
    private now: () => number = Date.now,
  ) {}
  configure(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.35;
    if (!enabled || !this.volume) this.stop();
  }
  setForeground(foreground: boolean) {
    this.foreground = foreground;
    if (!foreground) this.stop();
  }
  play(cue: SoundCue, options: CueOptions = {}) {
    if (options.eventKey) {
      const key = `${options.scope ?? ''}:${cue}:${options.eventKey}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
      if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    }
    if (!this.enabled || !this.volume || !this.foreground) return;
    const detail = soundCueDetails[cue];
    const now = this.now();
    if (
      detail.lane === 'ui' &&
      cue !== 'countdown' &&
      (now < this.eventUntil || now - this.lastUiAt < 65)
    )
      return;
    if (detail.lane === 'ui') this.lastUiAt = now;
    else {
      if (now < this.eventUntil && priority(cue) < this.eventPriority) return;
      this.eventUntil = now + detail.duration;
      this.eventPriority = priority(cue);
      this.transport.stop('ui');
    }
    this.activeScopes[detail.lane] = options.scope;
    this.transport.play(cue, this.volume * detail.gain * (options.speech ? 0.3 : 1), detail.lane);
  }
  unlock() {
    this.transport.unlock();
  }
  stopScope(scope: string) {
    for (const lane of ['ui', 'event'] as const)
      if (this.activeScopes[lane] === scope) {
        this.transport.stop(lane);
        delete this.activeScopes[lane];
        if (lane === 'event') this.eventUntil = 0;
      }
  }
  stop() {
    this.transport.stop();
    this.activeScopes = {};
    this.eventUntil = 0;
    this.lastUiAt = -Infinity;
  }
  dispose() {
    this.stop();
    this.transport.dispose();
  }
}
