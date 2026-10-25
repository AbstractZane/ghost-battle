import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoRivalClip } from './videoRival';
const mocks = vi.hoisted(() => ({
  pick: vi.fn(),
  info: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.pick }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/',
  getInfoAsync: mocks.info,
  copyAsync: mocks.copy,
  deleteAsync: mocks.remove,
  makeDirectoryAsync: mocks.mkdir,
}));
vi.mock('@/storage/database', () => ({
  getDatabase: () => Promise.resolve({ getFirstAsync: mocks.read, runAsync: mocks.write }),
}));
import { clipRepository } from './clipRepository';
const clip: VideoRivalClip = {
  version: 1,
  id: 'clip-1',
  name: 'Rival',
  uri: 'file:///app/creator-studio/clip-1.mp4',
  durationMs: 5000,
  repTimesMs: [1000, 3000],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.info.mockResolvedValue({ exists: true });
  mocks.copy.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
});
describe('device-only filming clips', () => {
  it('loads saved timing without uploading footage or changing workouts', async () => {
    mocks.read.mockResolvedValue({ value: JSON.stringify(clip) });
    expect(await clipRepository.load()).toEqual(clip);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it('uses the system picker and leaves cancellation unchanged', async () => {
    mocks.pick.mockResolvedValue({ canceled: true, assets: null });
    expect(await clipRepository.pick()).toBeNull();
    expect(mocks.pick).toHaveBeenCalledWith({
      type: 'video/*',
      multiple: false,
      copyToCacheDirectory: true,
    });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it('stores an explicit chosen clip in its own directory and starts with no invented reps', async () => {
    mocks.pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/selected.mp4', name: '../selected.MP4' }],
    });
    const picked = await clipRepository.pick();
    expect(picked?.uri).toMatch(/^file:\/\/\/app\/creator-studio\/clip_[a-z0-9_]+\.mp4$/);
    expect(picked).toMatchObject({ durationMs: 0, repTimesMs: [] });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('only commits a usable local clip with real editor timings', async () => {
    expect(await clipRepository.save(clip)).toEqual(clip);
    expect(mocks.write).toHaveBeenCalledWith(
      expect.stringContaining('metadata'),
      'creator_studio_clip_v1',
      JSON.stringify(clip),
    );
    await expect(clipRepository.save({ ...clip, repTimesMs: [] })).rejects.toThrow();
    await expect(
      clipRepository.save({ ...clip, uri: 'file:///elsewhere/video.mp4' }),
    ).rejects.toThrow();
    expect(mocks.write).toHaveBeenCalledOnce();
  });
  it('does not discard other files or traverse outside its clip directory', async () => {
    await clipRepository.discard('file:///app/creator-studio/../private.mp4');
    await clipRepository.discard('file:///app/workout.mp4');
    expect(mocks.remove).not.toHaveBeenCalled();
    await clipRepository.discard(clip.uri);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(clip.uri, { idempotent: true });
  });
  it('recovers honestly from a missing or corrupt saved video', async () => {
    mocks.read.mockResolvedValue({ value: JSON.stringify(clip) });
    mocks.info.mockResolvedValue({ exists: false });
    await expect(clipRepository.load()).rejects.toThrow('no longer');
    mocks.read.mockResolvedValue({ value: '{' });
    await expect(clipRepository.load()).rejects.toThrow('could not load');
  });
});
