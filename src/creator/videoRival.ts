import { parseMotionTrack, type GhostMotionTrack } from './ghostMotion';
import type { GhostRun } from './ghostRecap';
/** Local recorded challenge. Never an online match, rating, or reward receipt. */
export interface VideoRivalClip {
  version: 1 | 2;
  id: string;
  name: string;
  uri: string;
  durationMs: number;
  repTimesMs: number[];
  motion?: GhostMotionTrack;
  analysisReviewed?: boolean;
  marking?: 'detector' | 'edited';
  gaps?: { fromMs: number; toMs: number }[];
}
export const isMotionOnly = (clip: VideoRivalClip) => clip.uri.startsWith('ghost:');

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
    (clip.version !== 1 && clip.version !== 2) ||
    typeof clip.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,90}$/.test(clip.id) ||
    typeof clip.name !== 'string' ||
    !clip.name.trim() ||
    clip.name.length > 32 ||
    typeof clip.uri !== 'string' ||
    !(
      clip.uri.startsWith('file://') ||
      clip.uri.startsWith('blob:') ||
      (clip.version === 2 && clip.uri === `ghost:${clip.id}`)
    ) ||
    typeof clip.durationMs !== 'number' ||
    !Number.isFinite(clip.durationMs) ||
    clip.durationMs < 1_000 ||
    clip.durationMs > 1_800_000
  )
    return null;
  try {
    const motion = clip.motion === undefined ? undefined : parseMotionTrack(clip.motion);
    if (
      motion === null ||
      (motion && motion.durationMs !== Math.round(clip.durationMs)) ||
      (clip.uri.startsWith('ghost:') && (!motion || clip.analysisReviewed !== true))
    )
      return null;
    const gaps =
      Array.isArray(clip.gaps) && clip.gaps.length <= 4600
        ? clip.gaps.filter(
            (g) =>
              g &&
              Number.isInteger(g.fromMs) &&
              Number.isInteger(g.toMs) &&
              g.fromMs >= 0 &&
              g.toMs >= g.fromMs &&
              g.toMs <= clip.durationMs!,
          )
        : undefined;
    return {
      version: clip.version,
      id: clip.id,
      name: clip.name.trim(),
      uri: clip.uri,
      durationMs: Math.round(clip.durationMs),
      repTimesMs: normalizeRepTimes(clip.repTimesMs, clip.durationMs),
      ...(motion
        ? {
            motion,
            analysisReviewed: clip.analysisReviewed === true,
            marking: clip.marking === 'detector' ? ('detector' as const) : ('edited' as const),
          }
        : {}),
      ...(gaps ? { gaps } : {}),
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
  private run: GhostRun = { version: 1, playerRepTimesMs: [], practice: false, interruptions: 0 };
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
      if (this.phase === 'active') this.run.interruptions++;
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
    this.run.playerRepTimesMs.push(Math.max(1, Math.round(this.elapsedMs)));
    return true;
  }
  canAcceptReps() {
    return this.phase === 'active' && this.playable;
  }
  /** Explicit media seek only. Never rolls back or fabricates accepted camera reps. */
  seek(positionMs: number) {
    if (this.phase === 'complete' || !Number.isFinite(positionMs)) return;
    if (this.phase === 'active') this.run.practice = true;
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
  resultRun(): GhostRun {
    return { ...this.run, playerRepTimesMs: [...this.run.playerRepTimesMs] };
  }
}

/** Motion-only challenges have no media player; inactive time never advances this clock. */
export class GhostActiveClock {
  private elapsed = 0;
  private last: number | null = null;
  tick(now: number, active: boolean): number {
    if (!Number.isFinite(now)) return this.elapsed;
    if (this.last !== null && now < this.last) return this.elapsed;
    if (active && this.last !== null) this.elapsed += Math.max(0, now - this.last);
    this.last = active ? now : null;
    return this.elapsed;
  }
  pause() {
    this.last = null;
  }
}
