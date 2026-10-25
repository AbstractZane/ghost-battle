import { beforeEach, expect, it, vi } from 'vitest';
import { validRepSequence } from '@/tests/poseFixtures';
import { analyzeVideo } from './analyzeVideo';
import type { VideoRivalClip } from './videoRival';
const bridge = vi.hoisted(() => ({ start: vi.fn(), poll: vi.fn(), cancel: vi.fn() }));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: { GhostVideoAnalysis: bridge },
}));
const clip: VideoRivalClip = {
  version: 1,
  id: 'native',
  uri: 'file:///app/selected.mp4',
  name: 'Ghost',
  durationMs: 5000,
  repTimesMs: [],
};
const names = [
  'nose',
  'leftEye',
  'rightEye',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  bridge.start.mockResolvedValue('job');
});
it('normalizes actual native presentation timestamps and runs the real rep detector', async () => {
  const samples = validRepSequence().map((p) =>
    JSON.stringify({
      state: 'pose',
      capturedAt: p.timestamp + 1,
      sourceWidth: 640,
      sourceHeight: 640,
      inputMirrored: false,
      orientation: 'up',
      inferenceLatencyMs: 0,
      candidate: {
        score: 0.95,
        secondScore: 0,
        bbox: [0, 0, 1, 1],
        landmarks: names.flatMap((n) => {
          const j = p.landmarks[n];
          return j ? [j.x, j.y, j.confidence] : [0, 0, 0];
        }),
      },
    }),
  );
  bridge.poll.mockResolvedValue(
    JSON.stringify({ state: 'complete', progress: 1, aspectRatio: 1, samples }),
  );
  const result = await analyzeVideo(clip, new AbortController().signal, vi.fn());
  expect(result.repTimesMs).toHaveLength(1);
  expect(result.motion.frames[0]?.atMs).toBe(0);
  expect(bridge.cancel).toHaveBeenCalledWith('job');
});
it('preserves absent frames as tracking gaps and does not synthesize repetitions', async () => {
  bridge.poll.mockResolvedValue(
    JSON.stringify({
      state: 'complete',
      progress: 1,
      aspectRatio: 1,
      samples: [JSON.stringify({ state: 'pose', capturedAt: 1, candidate: { score: 0 } })],
    }),
  );
  const result = await analyzeVideo(clip, new AbortController().signal, vi.fn());
  expect(result.repTimesMs).toEqual([]);
  expect(result.gaps).toEqual([{ fromMs: 0, toMs: 5000 }]);
});
it('cancels a job when the editor aborts and ignores its late completed batch', async () => {
  let reply!: (value: string) => void;
  bridge.poll.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        reply = resolve;
      }),
  );
  const abort = new AbortController();
  const progress = vi.fn();
  const task = analyzeVideo(clip, abort.signal, progress);
  await Promise.resolve();
  await Promise.resolve();
  abort.abort();
  reply(JSON.stringify({ state: 'complete', progress: 1, aspectRatio: 1, samples: [] }));
  await expect(task).rejects.toThrow();
  expect(bridge.cancel).toHaveBeenCalledWith('job');
  expect(progress).not.toHaveBeenCalled();
});
it('rejects unsupported lengths and forwards decoder failure with manual recovery', async () => {
  await expect(
    analyzeVideo({ ...clip, durationMs: 300001 }, new AbortController().signal, vi.fn()),
  ).rejects.toThrow('5 minutes');
  expect(bridge.start).not.toHaveBeenCalled();
  bridge.poll.mockResolvedValue(
    JSON.stringify({ state: 'error', error: 'Use manual markers', samples: [] }),
  );
  await expect(analyzeVideo(clip, new AbortController().signal, vi.fn())).rejects.toThrow('manual');
  expect(bridge.cancel).toHaveBeenCalledWith('job');
});
