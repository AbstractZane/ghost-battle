import { describe, expect, it } from 'vitest';
import {
  normalizeRepTimes,
  parseVideoRivalClip,
  VideoRivalRound,
  videoRivalScore,
  type VideoRivalClip,
} from './videoRival';
const clip: VideoRivalClip = {
  version: 1,
  id: 'test-clip',
  name: 'Rival',
  uri: 'file:///private/rival.mp4',
  durationMs: 5000,
  repTimesMs: [1000, 3000, 5000],
};
describe('private video-opponent rounds', () => {
  it('normalizes exact video times and rejects invalid markers', () => {
    expect(normalizeRepTimes([3000, 1000, 1000], 5000)).toEqual([1000, 3000]);
    for (const value of [[0], [0.1], [-1], [5001], [NaN], ['1000']])
      expect(() => normalizeRepTimes(value, 5000)).toThrow();
    expect(parseVideoRivalClip({ ...clip, uri: 'https://example.com/clip.mp4' })).toBeNull();
    expect(videoRivalScore(clip.repTimesMs, NaN)).toBe(0);
  });
  it('only admits live reps during actual playback and deduplicates indices', () => {
    const round = new VideoRivalRound(clip);
    expect(round.acceptRep(1)).toBe(false);
    round.countdown();
    round.start();
    expect(round.acceptRep(1)).toBe(false);
    round.observe(1200, true);
    expect(round.acceptRep(1)).toBe(true);
    expect(round.acceptRep(1)).toBe(false);
    round.observe(1400, false);
    expect(round.acceptRep(2)).toBe(false);
    expect(round.snapshot()).toMatchObject({ elapsedMs: 1200, playerScore: 1, opponentScore: 1 });
    round.observe(1600, true);
    expect(round.acceptRep(2)).toBe(true);
  });
  it('freezes both scores on pause, ignores old positions, and ends with the clip', () => {
    const round = new VideoRivalRound(clip);
    round.countdown();
    round.start();
    round.observe(3000, true);
    round.acceptRep(1);
    round.pause();
    round.observe(4000, true);
    round.acceptRep(2);
    expect(round.snapshot()).toMatchObject({ elapsedMs: 3000, playerScore: 1, opponentScore: 2 });
    round.resume();
    round.observe(1000, true);
    expect(round.acceptRep(2)).toBe(false);
    round.observe(3200, true);
    round.acceptRep(2);
    round.acceptRep(3);
    round.observe(4999, false, true);
    expect(round.snapshot()).toMatchObject({
      phase: 'complete',
      elapsedMs: 5000,
      opponentScore: 3,
      playerScore: 3,
      outcome: 'draw',
    });
    expect(round.acceptRep(4)).toBe(false);
  });
  it('owns an immutable timeline and keeps retries independent', () => {
    const source = { ...clip, repTimesMs: [...clip.repTimesMs] };
    const round = new VideoRivalRound(source);
    source.repTimesMs.push(4000);
    round.countdown();
    round.start();
    round.observe(5000, true);
    expect(round.snapshot().opponentScore).toBe(3);
    expect(new VideoRivalRound(clip).snapshot()).toMatchObject({
      playerScore: 0,
      opponentScore: 0,
      phase: 'positioning',
    });
  });
  it('does not award a win from an early/stale end callback', () => {
    const round = new VideoRivalRound(clip);
    round.countdown();
    round.start();
    round.observe(1000, true);
    round.observe(1100, false, true);
    expect(round.snapshot()).toMatchObject({ phase: 'paused', outcome: null, elapsedMs: 1000 });
    expect(round.acceptRep(1)).toBe(false);
  });
  it('returns a paused countdown to countdown, rather than skipping directly into a match', () => {
    const round = new VideoRivalRound(clip);
    round.countdown();
    round.pause();
    round.resume();
    expect(round.snapshot().phase).toBe('countdown');
    expect(round.acceptRep(1)).toBe(false);
    round.cancelCountdown();
    expect(round.snapshot().phase).toBe('positioning');
  });
});
