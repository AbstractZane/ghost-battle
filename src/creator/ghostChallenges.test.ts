import { describe, expect, it } from 'vitest';
import { addGhostMarker, ghostBattlePresentation, parseGhostChallenge } from './ghostChallenges';
import { VideoRivalRound, type VideoRivalClip } from './videoRival';
const clip: VideoRivalClip = {
  version: 1,
  id: 'clip',
  name: 'Ghost',
  uri: 'file:///app/clip.mp4',
  durationMs: 5000,
  repTimesMs: [1000, 3000, 5000],
};
describe('Ghost Battle competition', () => {
  it('keeps markers sorted and unique while allowing real edits', () => {
    expect(addGhostMarker([3000], 1000, 5000)).toEqual([1000, 3000]);
    expect(addGhostMarker([1000], 1050, 5000)).toEqual([1000]);
    for (const time of [NaN, 0, -1, 6000])
      expect(addGhostMarker([1000], time, 5000)).toEqual([1000]);
  });
  it('validates saved challenges and normalizes duplicate timestamps', () => {
    const value = {
      version: 1,
      id: 'clip',
      title: 'Morning rivalry',
      clip: { ...clip, repTimesMs: [3000, 1000, 1000] },
      savedAt: '2026-10-25T00:00:00Z',
    };
    expect(parseGhostChallenge(value)?.clip.repTimesMs).toEqual([1000, 3000]);
    expect(parseGhostChallenge({ ...value, id: 'other' })).toBeNull();
    expect(parseGhostChallenge({ ...value, clip: { ...clip, repTimesMs: [] } })).toBeNull();
  });
  it('seeks the ghost deterministically without duplicating or removing real accepted reps', () => {
    const round = new VideoRivalRound(clip);
    round.countdown();
    round.start();
    round.observe(3000, true);
    round.acceptRep(1);
    round.pause();
    round.seek(1000);
    expect(round.snapshot()).toMatchObject({
      phase: 'paused',
      elapsedMs: 1000,
      remainingMs: 4000,
      playerScore: 1,
      opponentScore: 1,
    });
    expect(round.acceptRep(2)).toBe(false);
    round.resume();
    expect(round.acceptRep(2)).toBe(false);
    round.observe(3000, true);
    expect(round.acceptRep(1)).toBe(false);
    expect(round.acceptRep(2)).toBe(true);
    expect(round.snapshot().opponentScore).toBe(2);
    round.seek(4000);
    round.observe(5000, false, true);
    expect(round.snapshot()).toMatchObject({
      outcome: 'defeat',
      playerScore: 2,
      opponentScore: 3,
      remainingMs: 0,
    });
    round.seek(0);
    expect(round.snapshot().elapsedMs).toBe(5000);
  });
  it.each([
    [4, 3, 'WIN', 1],
    [2, 5, 'LOSS', 3],
    [0, 0, 'TIE', 0],
  ] as const)(
    'reports %s vs %s as %s with the actual margin',
    (playerScore, opponentScore, result, margin) => {
      const view = ghostBattlePresentation(
        {
          phase: 'complete',
          elapsedMs: 5000,
          remainingMs: 0,
          playerScore,
          opponentScore,
          outcome: null,
        },
        5000,
      );
      expect(view).toMatchObject({ result, margin, progress: 1 });
      expect(view.share).toBeGreaterThanOrEqual(0);
      expect(view.share).toBeLessThanOrEqual(1);
    },
  );
});
