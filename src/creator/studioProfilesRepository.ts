import { Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from '@/storage/database';
import { createId } from '@/utils/format';
import { parseStudioProfiles, type StudioProfiles } from './studioProfiles';

const KEY = 'creator_studio_profiles_v1';
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
function directory() {
  if (!FileSystem.documentDirectory) throw new Error('Local photo storage is unavailable.');
  return `${FileSystem.documentDirectory}creator-studio-portraits/`;
}
function owned(uri: string) {
  const base = directory();
  return uri.startsWith(base) && /^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(uri.slice(base.length));
}
async function readStored(): Promise<StudioProfiles | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM metadata WHERE key = ?',
    KEY,
  );
  try {
    return row ? parseStudioProfiles(JSON.parse(row.value)) : null;
  } catch {
    return null;
  }
}
export const studioProfilesRepository = {
  async load(): Promise<StudioProfiles | null> {
    const saved = await readStored();
    if (!saved) return null;
    for (const identity of [saved.player, saved.opponent]) {
      if (
        identity.photoUri &&
        (!owned(identity.photoUri) || !(await FileSystem.getInfoAsync(identity.photoUri)).exists)
      )
        identity.photoUri = null;
    }
    return saved;
  },
  async pickPhoto(): Promise<string | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/jpeg', 'image/png', 'image/webp'],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) throw new Error('No photo was selected.');
    const extension = asset.name.split('.').at(-1)?.toLowerCase();
    const format =
      asset.mimeType === 'image/jpeg'
        ? 'jpg'
        : asset.mimeType === 'image/png'
          ? 'png'
          : asset.mimeType === 'image/webp'
            ? 'webp'
            : !asset.mimeType && extension && /^(jpg|jpeg|png|webp)$/.test(extension)
              ? extension === 'jpeg'
                ? 'jpg'
                : extension
              : null;
    if (!format) throw new Error('Choose a JPG, PNG, or WebP photo.');
    if (asset.size && asset.size > MAX_PHOTO_BYTES)
      throw new Error('Choose a photo smaller than 12 MB.');
    const uri = `${directory()}${createId('portrait')}.${format}`;
    await FileSystem.makeDirectoryAsync(directory(), { intermediates: true });
    try {
      await FileSystem.copyAsync({ from: asset.uri, to: uri });
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory || info.size > MAX_PHOTO_BYTES)
        throw new Error('Choose a photo smaller than 12 MB.');
      await new Promise<void>((resolve, reject) => {
        Image.getSize(
          uri,
          (width, height) => {
            if (width > 0 && height > 0 && width * height <= 100_000_000) resolve();
            else reject(new Error('Choose a smaller photo that this phone can display.'));
          },
          () => reject(new Error('That photo could not open. Try a JPG or PNG.')),
        );
      });
      return uri;
    } catch (error) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      throw error;
    }
  },
  async save(profiles: StudioProfiles): Promise<StudioProfiles> {
    const valid = parseStudioProfiles(profiles);
    if (!valid) throw new Error('Enter a name for both players, up to 32 characters each.');
    const photos = new Set([valid.player.photoUri, valid.opponent.photoUri]);
    for (const uri of photos) {
      if (uri && (!owned(uri) || !(await FileSystem.getInfoAsync(uri)).exists))
        throw new Error('That photo is no longer available. Choose it again.');
    }
    const previous = await readStored();
    const database = await getDatabase();
    await database.runAsync(
      'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
      KEY,
      JSON.stringify(valid),
    );
    // Retire only app-owned copies after the new identities are durably saved.
    for (const uri of new Set([previous?.player.photoUri, previous?.opponent.photoUri])) {
      if (uri && !photos.has(uri) && owned(uri))
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
    return valid;
  },
  async discardPhoto(uri: string) {
    if (owned(uri)) await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};
