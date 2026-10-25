/** Private, local staged gameplay. Never an online match, rating, or reward receipt. */
export interface VideoRivalClip {
  version: 1;
  id: string;
  name: string;
  uri: string;
  durationMs: number;
  repTimesMs: number[];
}

export function normalizeRepTimes(value: unknown, durationMs: number): number[] {
  if (!Array.isArray(value) || value.length > 5_000) throw new Error('Invalid pushup timings.');
  const times = value
    .map((time: unknown) => {
      if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0 || time > durationMs)
        throw new Error('Each pushup must fall inside the video.');
      const rounded = Math.round(time);
      if (rounded <= 0 || rounded > Math.round(durationMs))
        throw new Error('Each pushup must fall inside the video.');
      return rounded;
    })
    .sort((a, b) => a - b);
  return [...new Set(times)];
}

export function parseVideoRivalClip(value: unknown): VideoRivalClip | null {
  if (!value || typeof value !== 'object') return null;
  const clip = value as Partial<VideoRivalClip>;
  if (
    clip.version !== 1 ||
    typeof clip.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,90}$/.test(clip.id) ||
    typeof clip.name !== 'string' ||
    !clip.name.trim() ||
    clip.name.length > 32 ||
    typeof clip.uri !== 'string' ||
    !(clip.uri.startsWith('file://') || clip.uri.startsWith('blob:')) ||
    typeof clip.durationMs !== 'number' ||
    !Number.isFinite(clip.durationMs) ||
    clip.durationMs < 1_000 ||
    clip.durationMs > 1_800_000
  )
    return null;
  try {
    return {
      version: 1,
      id: clip.id,
      name: clip.name.trim(),
      uri: clip.uri,
      durationMs: Math.round(clip.durationMs),
      repTimesMs: normalizeRepTimes(clip.repTimesMs, clip.durationMs),
    };
  } catch {
    return null;
  }
}

export function videoRivalScore(times: readonly number[], positionMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return 0;
  let low = 0,
    high = times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (times[mid]! <= positionMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

export type VideoRoundPhase = 'positioning' | 'countdown' | 'active' | 'paused' | 'complete';
export interface VideoRoundSnapshot {
  phase: VideoRoundPhase;
  elapsedMs: number;
  remainingMs: number;
  playerScore: number;
  opponentScore: number;
  outcome: 'victory' | 'defeat' | 'draw' | null;
}

/** Playback time is the only round clock. No wall-clock score schedules or fake server writes. */
export class VideoRivalRound {
  private phase: VideoRoundPhase = 'positioning';
  private elapsedMs = 0;
  private playerScore = 0;
  private lastRepIndex = 0;
  private playable = false;
  private resumePhase: 'active' | 'countdown' = 'active';
  readonly clip: VideoRivalClip;
  constructor(clip: VideoRivalClip) {
    const valid = parseVideoRivalClip(clip);
    if (!valid || !valid.repTimesMs.length)
      throw new Error('Add the video’s pushup timings first.');
    this.clip = valid; // Own a normalized copy; edits cannot change a running take.
  }
  countdown() {
    if (this.phase === 'positioning') this.phase = 'countdown';
  }
  cancelCountdown() {
    if (this.phase === 'countdown') this.phase = 'positioning';
  }
  start() {
    if (this.phase === 'countdown') {
      this.phase = 'active';
      this.playable = false;
    }
  }
  pause() {
    if (this.phase === 'active' || this.phase === 'countdown') {
      this.resumePhase = this.phase;
      this.phase = 'paused';
    }
    this.playable = false;
  }
  resume() {
    if (this.phase === 'paused') {
      this.phase = this.resumePhase;
      this.playable = false;
    }
  }
  observe(positionMs: number, playable: boolean, ended = false) {
    if (!playable) this.playable = false;
    if (this.phase !== 'active' || !Number.isFinite(positionMs) || positionMs < this.elapsedMs)
      return;
    this.playable = playable;
    if (ended && positionMs < this.clip.durationMs - 250) {
      this.pause();
      return;
    }
    // Paused/buffering callbacks cannot move the round ahead. End events may have playing=false.
    if (!playable && !ended) return;
    this.elapsedMs = Math.min(this.clip.durationMs, Math.max(0, positionMs));
    if (ended || this.elapsedMs >= this.clip.durationMs) {
      this.elapsedMs = this.clip.durationMs;
      this.phase = 'complete';
      this.playable = false;
    }
  }
  acceptRep(index: number): boolean {
    if (
      this.phase !== 'active' ||
      !this.playable ||
      !Number.isInteger(index) ||
      index <= this.lastRepIndex
    )
      return false;
    this.lastRepIndex = index;
    this.playerScore++;
    return true;
  }
  canAcceptReps() {
    return this.phase === 'active' && this.playable;
  }
  /** Explicit media seek only. Never rolls back or fabricates accepted camera reps. */
  seek(positionMs: number) {
    if (this.phase === 'complete' || !Number.isFinite(positionMs)) return;
    this.elapsedMs = Math.min(this.clip.durationMs, Math.max(0, positionMs));
    this.playable = false;
  }
  snapshot(): VideoRoundSnapshot {
    const opponentScore = videoRivalScore(this.clip.repTimesMs, this.elapsedMs);
    return {
      phase: this.phase,
      elapsedMs: this.elapsedMs,
      remainingMs: this.clip.durationMs - this.elapsedMs,
      playerScore: this.playerScore,
      opponentScore,
      outcome:
        this.phase === 'complete'
          ? this.playerScore > opponentScore
            ? 'victory'
            : this.playerScore < opponentScore
              ? 'defeat'
              : 'draw'
          : null,
    };
  }
}
