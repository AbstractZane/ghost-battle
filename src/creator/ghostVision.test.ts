import { describe, expect, it } from 'vitest';
import { validRepSequence, poseAt } from '@/tests/poseFixtures';
import { GhostAnalysisAccumulator } from './ghostAnalysis';
import { motionFrame, motionAt, parseMotionTrack, type GhostMotionTrack } from './ghostMotion';
import { parseGhostFile, exportGhostFile } from './ghostPackage';
import { buildGhostRecap } from './ghostRecap';
import {
  GhostActiveClock,
  parseVideoRivalClip,
  VideoRivalRound,
  type VideoRivalClip,
} from './videoRival';
const motion: GhostMotionTrack = {
  version: 1,
  durationMs: 5000,
  aspectRatio: 1,
  frames: [motionFrame(poseAt(165, 0), 0), motionFrame(poseAt(165, 67), 67)],
};
const clip: VideoRivalClip = {
  version: 2,
  id: 'motion_test',
  uri: 'ghost:motion_test',
  name: 'My ghost',
  durationMs: 5000,
  repTimesMs: [1000, 3000],
  motion,
  analysisReviewed: true,
  marking: 'detector',
};
describe('measured video analysis', () => {
  it('passes video-time poses through the unchanged detector and counts one accepted rep', () => {
    const a = new GhostAnalysisAccumulator(5000, 1);
    for (const pose of validRepSequence()) a.add(pose, pose.timestamp);
    const result = a.finish();
    expect(result.repTimesMs).toHaveLength(1);
    expect(result.reviewed).toBe(false);
    expect(result.motion.frames.every((f) => f.joints.length === 12)).toBe(true);
  });
  it('ignores duplicate/out-of-order frames, and retains gaps without bridging a partial rep', () => {
    const a = new GhostAnalysisAccumulator(5000, 1);
    a.add(poseAt(165, 0), 0);
    a.add(poseAt(165, 1), 0);
    a.add(null, 100);
    a.add(null, 90);
    a.add(poseAt(82, 1200), 1200);
    a.add(poseAt(165, 1800), 1800);
    const result = a.finish();
    expect(result.motion.frames).toHaveLength(4);
    expect(result.repTimesMs).toEqual([]);
    expect(result.gaps).toContainEqual({ fromMs: 100, toMs: 1200 });
  });
  it('does not promote shallow or modified reps into accepted video markers', () => {
    const a = new GhostAnalysisAccumulator(5000, 1);
    for (const p of validRepSequence(0, { kneeAngle: 110 })) a.add(p, p.timestamp);
    expect(a.finish().repTimesMs).toEqual([]);
  });
});
describe('portable body-only motion', () => {
  it('validates and owns a copy of motion data', () => {
    const parsed = parseMotionTrack(motion)!;
    expect(parsed).toEqual(motion);
    expect(parsed.frames).not.toBe(motion.frames);
    expect(
      parseMotionTrack({ ...motion, frames: [...motion.frames, motion.frames[0]] }),
    ).toBeNull();
    expect(parseMotionTrack({ ...motion, aspectRatio: Infinity })).toBeNull();
    expect(
      parseMotionTrack({ ...motion, frames: [{ atMs: 0, joints: [[NaN, 0, 1]] }] }),
    ).toBeNull();
  });
  it('does not interpolate through missing joints or long gaps', () => {
    const missing = { atMs: 67, joints: Array(12).fill(null) };
    expect(
      motionAt({ ...motion, frames: [motion.frames[0]!, missing] }, 40).every((j) => j === null),
    ).toBe(true);
    expect(motionAt(motion, 400).every((j) => j === null)).toBe(true);
    expect(motionAt(motion, -1).every((j) => j === null)).toBe(true);
  });
  it('round-trips a reviewed motion-only challenge without media, face, or path fields', () => {
    const text = exportGhostFile({ ...clip, uri: 'file:///private/original.mp4' }, 'Race this');
    expect(text).not.toContain('file:');
    expect(text).not.toContain('nose');
    expect(text).not.toContain('photo');
    const parsed = parseGhostFile(text);
    expect(parsed.repTimesMs).toEqual([1000, 3000]);
    const stripped = parseGhostFile(
      JSON.stringify({ ...parsed, uri: 'secret', photoUri: 'secret' }),
    );
    expect(stripped).not.toHaveProperty('uri');
    expect(stripped).not.toHaveProperty('photoUri');
    expect(parseVideoRivalClip(clip)?.uri).toBe('ghost:motion_test');
    expect(parseVideoRivalClip({ ...clip, motion: undefined })).toBeNull();
  });
  it('requires review and rejects oversized, corrupt, unsupported, or empty challenges', () => {
    expect(() => exportGhostFile({ ...clip, analysisReviewed: false }, 'Race')).toThrow('confirm');
    const data = JSON.parse(exportGhostFile(clip, 'Race')) as Record<string, unknown>;
    for (const changed of [
      { version: 9 },
      { repTimesMs: [] },
      { durationMs: 9999 },
      { repTimesMs: [9000] },
    ])
      expect(() => parseGhostFile(JSON.stringify({ ...data, ...changed }))).toThrow();
    expect(() => parseGhostFile('x'.repeat(5 * 1024 * 1024 + 1))).toThrow('5 MB');
  });
});
describe('race timing and explanation', () => {
  it('uses only active monotonic time and ignores inactive time', () => {
    const clock = new GhostActiveClock();
    expect(clock.tick(100, true)).toBe(0);
    expect(clock.tick(600, true)).toBe(500);
    clock.pause();
    expect(clock.tick(10000, true)).toBe(500);
    expect(clock.tick(10500, true)).toBe(1000);
    clock.tick(11000, false);
    expect(clock.tick(90000, true)).toBe(1000);
    expect(clock.tick(NaN, true)).toBe(1000);
  });
  it('records each accepted player rep once at the authoritative clock', () => {
    const round = new VideoRivalRound(clip);
    round.countdown();
    round.start();
    round.observe(1200, true);
    round.acceptRep(1);
    round.acceptRep(1);
    round.pause();
    round.acceptRep(2);
    round.resume();
    round.observe(2200, true);
    round.acceptRep(2);
    const run = round.resultRun();
    expect(run.playerRepTimesMs).toEqual([1200, 2200]);
    expect(run.interruptions).toBe(1);
    run.playerRepTimesMs.push(4000);
    expect(round.resultRun().playerRepTimesMs).toHaveLength(2);
  });
  it('groups simultaneous score events and identifies the final winning lead', () => {
    const recap = buildGhostRecap(
      { version: 1, playerRepTimesMs: [1000, 2000, 4000], practice: false, interruptions: 0 },
      [1000, 3000],
      5000,
    );
    expect(recap.headline).toBe('You took the winning lead at 00:04.');
    expect(recap.segments[0]).toEqual({ fromMs: 0, toMs: 2000, lead: 0 });
    expect(recap.target).toBe(3);
    expect(recap.segments.reduce((n, s) => n + s.toMs - s.fromMs, 0)).toBe(5000);
  });
  it('reports ties and interruptions honestly and flags seeking as practice', () => {
    const run = {
      version: 1 as const,
      playerRepTimesMs: [1000],
      practice: false,
      interruptions: 0,
    };
    expect(buildGhostRecap(run, [1000], 5000).headline).toContain('finished level');
    expect(buildGhostRecap({ ...run, interruptions: 1 }, [1000], 5000).headline).toContain(
      'Practice',
    );
    const r = new VideoRivalRound(clip);
    r.countdown();
    r.start();
    r.observe(2000, true);
    r.seek(1000);
    expect(r.resultRun().practice).toBe(true);
  });
});
