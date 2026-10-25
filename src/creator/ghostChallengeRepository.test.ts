import { beforeEach, expect, it, vi } from 'vitest';
import type { VideoRivalClip } from './videoRival';
const mocks = vi.hoisted(() => ({
  state: new Map<string, string>(),
  legacy: vi.fn(),
  resolve: vi.fn(),
  write: vi.fn(),
}));
vi.mock('./ghostPersistence', () => ({
  ghostPersistence: {
    read: (key: string) => Promise.resolve(mocks.state.get(key) ?? null),
    write: mocks.write,
  },
}));
vi.mock('./clipRepository', () => ({
  clipRepository: { load: mocks.legacy, resolve: mocks.resolve },
}));
import { ghostChallengeRepository as repo } from './ghostChallengeRepository';
const clip: VideoRivalClip = {
  version: 1,
  id: 'first',
  name: 'Ghost',
  uri: 'file:///app/first.mp4',
  durationMs: 5000,
  repTimesMs: [1000, 3000],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.clear();
  mocks.legacy.mockResolvedValue(null);
  mocks.resolve.mockImplementation((value: VideoRivalClip) => Promise.resolve(value));
  mocks.write.mockImplementation((key: string, value: string) => {
    mocks.state.set(key, value);
    return Promise.resolve();
  });
});
it('imports the previously selected challenge once and preserves it across reloads', async () => {
  mocks.legacy.mockResolvedValue(clip);
  expect(await repo.list()).toHaveLength(1);
  expect(await repo.list()).toHaveLength(1);
  expect(mocks.legacy).toHaveBeenCalledOnce();
});
it('retains separate challenges across concurrent saves and edits without duplicate entries', async () => {
  await repo.list();
  await Promise.all([
    repo.save(clip, 'First'),
    repo.save({ ...clip, id: 'second', uri: 'file:///app/second.mp4' }, 'Second'),
  ]);
  expect(await repo.list()).toHaveLength(2);
  await repo.save({ ...clip, repTimesMs: [1000, 3000, 4000] }, 'First edited');
  const saved = await repo.list();
  expect(saved).toHaveLength(2);
  expect(saved.find((x) => x.id === 'first')?.clip.repTimesMs).toEqual([1000, 3000, 4000]);
});
it('does not erase a library after failed saves, corrupted metadata, or missing media', async () => {
  await repo.save(clip, 'Safe');
  const before = [...mocks.state.entries()];
  mocks.resolve.mockResolvedValue(null);
  await expect(repo.save(clip, 'Missing')).rejects.toThrow('missing');
  expect([...mocks.state.entries()]).toEqual(before);
  await expect(repo.open((await repo.list())[0]!)).rejects.toThrow('no longer');
  mocks.state.set('ghost_battle_library_v1', 'broken');
  await expect(repo.list()).rejects.toThrow('could not load');
  expect(mocks.state.get('ghost_battle_library_v1')).toBe('broken');
});
it('recovers its command queue after a storage failure', async () => {
  await repo.list();
  mocks.write.mockRejectedValueOnce(new Error('Disk full'));
  await expect(repo.save(clip, 'Try')).rejects.toThrow('Disk full');
  await repo.save(clip, 'Retry');
  expect((await repo.list())[0]?.title).toBe('Retry');
});
