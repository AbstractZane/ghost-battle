import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultStudioProfiles, parseStudioProfiles } from './studioProfiles';
const mocks = vi.hoisted(() => ({
  pick: vi.fn(),
  info: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  size: vi.fn(),
}));
vi.mock('react-native', () => ({ Image: { getSize: mocks.size } }));
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
import { studioProfilesRepository } from './studioProfilesRepository';
const photo = 'file:///app/creator-studio-portraits/portrait_1.jpg';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.info.mockResolvedValue({ exists: true, size: 10000, isDirectory: false });
  mocks.copy.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  mocks.size.mockImplementation((_uri: string, success: (width: number, height: number) => void) =>
    success(800, 600),
  );
});
describe('local Studio names and portraits', () => {
  it('preserves legacy default names while rejecting malformed identities', () => {
    expect(defaultStudioProfiles(' Athlete ', 'Clip rival').player.name).toBe('Athlete');
    expect(defaultStudioProfiles('', '').opponent.name).toBe('Rival');
    const valid = defaultStudioProfiles('Athlete');
    expect(parseStudioProfiles({ ...valid, player: { name: ' ', photoUri: null } })).toBeNull();
    expect(
      parseStudioProfiles({
        ...valid,
        player: { name: 'Athlete', photoUri: 'https://host/photo.jpg' },
      }),
    ).toBeNull();
    expect(
      parseStudioProfiles({ ...valid, player: { name: 'x'.repeat(33), photoUri: null } }),
    ).toBeNull();
  });
  it('persists both identities independently of video timings and public profiles', async () => {
    const profiles = defaultStudioProfiles('My recording name', 'My rival');
    profiles.player.photoUri = photo;
    expect(await studioProfilesRepository.save(profiles)).toEqual(profiles);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('metadata'),
      'creator_studio_profiles_v1',
      JSON.stringify(profiles),
    );
    mocks.read.mockResolvedValue({ value: JSON.stringify(profiles) });
    expect(await studioProfilesRepository.load()).toEqual(profiles);
  });
  it('imports only explicitly selected image copies and ignores picker cancellation', async () => {
    mocks.pick.mockResolvedValueOnce({ canceled: true });
    expect(await studioProfilesRepository.pickPhoto()).toBeNull();
    expect(mocks.copy).not.toHaveBeenCalled();
    mocks.pick.mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: 'content://selected/photo', name: 'photo.jpg', mimeType: 'image/jpeg', size: 10000 },
      ],
    });
    const uri = await studioProfilesRepository.pickPhoto();
    expect(uri).toMatch(/^file:\/\/\/app\/creator-studio-portraits\/portrait_[a-z0-9_]+\.jpg$/);
    expect(mocks.copy).toHaveBeenCalledWith({ from: 'content://selected/photo', to: uri });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('rejects oversized or undecodable pictures without saving them', async () => {
    mocks.pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'content://photo', name: 'photo.jpg', size: 13 * 1024 * 1024 }],
    });
    await expect(studioProfilesRepository.pickPhoto()).rejects.toThrow('12 MB');
    expect(mocks.copy).not.toHaveBeenCalled();
    mocks.pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'content://photo', name: 'photo.png', size: 10000 }],
    });
    mocks.size.mockImplementation((_uri: string, _success: unknown, failure: () => void) =>
      failure(),
    );
    await expect(studioProfilesRepository.pickPhoto()).rejects.toThrow('could not open');
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.stringContaining('creator-studio-portraits/'),
      { idempotent: true },
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('only deletes replaced app-owned portraits after a successful durable save', async () => {
    const old = defaultStudioProfiles('Athlete');
    old.player.photoUri = photo;
    mocks.read.mockResolvedValue({ value: JSON.stringify(old) });
    mocks.write.mockRejectedValueOnce(new Error('disk full'));
    await expect(studioProfilesRepository.save(defaultStudioProfiles('New name'))).rejects.toThrow(
      'disk full',
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    await studioProfilesRepository.save(defaultStudioProfiles('New name'));
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(photo, { idempotent: true });
    await studioProfilesRepository.discardPhoto(
      'file:///app/creator-studio-portraits/../other.jpg',
    );
    await studioProfilesRepository.discardPhoto('file:///phone/original.jpg');
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('keeps names when photos are missing and refuses non-owned files on save', async () => {
    const profiles = defaultStudioProfiles('My name', 'Rival name');
    profiles.player.photoUri = photo;
    profiles.opponent.photoUri = 'file:///phone/original.jpg';
    mocks.read.mockResolvedValue({ value: JSON.stringify(profiles) });
    mocks.info.mockResolvedValue({ exists: false });
    expect(await studioProfilesRepository.load()).toEqual(
      defaultStudioProfiles('My name', 'Rival name'),
    );
    await expect(studioProfilesRepository.save(profiles)).rejects.toThrow('no longer available');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
