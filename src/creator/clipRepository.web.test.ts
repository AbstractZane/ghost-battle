import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  pick: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.pick }));
vi.mock('./browserStore', () => ({
  browserStore: {
    read: (key: string) => Promise.resolve(mocks.state.get(key)),
    write: mocks.write,
    remove: mocks.remove,
  },
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.state.clear();
  mocks.write.mockImplementation((key: string, value: unknown) => {
    mocks.state.set(key, value);
    return Promise.resolve();
  });
  mocks.remove.mockImplementation((key: string) => {
    mocks.state.delete(key);
    return Promise.resolve();
  });
  let id = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:http://localhost/${++id}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
it('imports a Blob locally and restores a fresh playback URL after a browser reload', async () => {
  const file = new File(['not camera frames'], 'own-video.mp4', { type: 'video/mp4' });
  mocks.pick.mockResolvedValue({
    canceled: false,
    assets: [{ file, uri: 'blob:http://localhost/picked' }],
  });
  const { clipRepository: first } = await import('./clipRepository.web');
  const picked = (await first.pick())!;
  const saved = await first.save({ ...picked, durationMs: 5000, repTimesMs: [3000, 1000, 1000] });
  expect(saved.repTimesMs).toEqual([1000, 3000]);
  vi.resetModules();
  const { clipRepository: reopened } = await import('./clipRepository.web');
  const restored = await reopened.load();
  expect(restored?.id).toBe(saved.id);
  expect(restored?.repTimesMs).toEqual([1000, 3000]);
  expect(restored?.uri).not.toBe(saved.uri);
  expect(restored?.uri).toMatch(/^blob:/);
});
it('preserves cancellation and never deletes unowned URLs', async () => {
  const { clipRepository } = await import('./clipRepository.web');
  mocks.pick.mockResolvedValue({ canceled: true });
  expect(await clipRepository.pick()).toBeNull();
  await clipRepository.discard('blob:http://someone-else/private');
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
it('reports missing videos and storage failure instead of inventing challenge data', async () => {
  const { clipRepository } = await import('./clipRepository.web');
  mocks.state.set('active-video', 'missing');
  await expect(clipRepository.load()).rejects.toThrow('missing');
  mocks.pick.mockResolvedValue({
    canceled: false,
    assets: [{ file: new File(['video'], 'a.mp4'), uri: 'blob:http://localhost/new' }],
  });
  mocks.write.mockRejectedValueOnce(new Error('Storage full'));
  await expect(clipRepository.pick()).rejects.toThrow('Storage full');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/new');
});
