import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from '@/storage/database';
import { createId } from '@/utils/format';
import { parseVideoRivalClip, type VideoRivalClip } from './videoRival';

const KEY = 'creator_studio_clip_v1';
function directory() {
  if (!FileSystem.documentDirectory) throw new Error('Local video storage is unavailable.');
  return `${FileSystem.documentDirectory}creator-studio/`;
}
function owned(uri: string) {
  const base = directory();
  return uri.startsWith(base) && /^[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(uri.slice(base.length));
}
export const clipRepository = {
  async resolve(clip: VideoRivalClip): Promise<VideoRivalClip | null> {
    const valid = parseVideoRivalClip(clip);
    if (!valid || !owned(valid.uri)) return null;
    return (await FileSystem.getInfoAsync(valid.uri)).exists ? valid : null;
  },
  async load(): Promise<VideoRivalClip | null> {
    const database = await getDatabase();
    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM metadata WHERE key = ?',
      KEY,
    );
    if (!row) return null;
    let clip: VideoRivalClip | null = null;
    try {
      clip = parseVideoRivalClip(JSON.parse(row.value));
    } catch {
      /* Authored recovery below. */
    }
    if (!clip || !owned(clip.uri))
      throw new Error('Your saved video setup could not load. Choose the clip again.');
    if (!(await FileSystem.getInfoAsync(clip.uri)).exists)
      throw new Error('That video is no longer on this device. Choose it again.');
    return clip;
  },
  async pick(): Promise<VideoRivalClip | null> {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'video/*',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return null;
    const asset = picked.assets[0];
    if (!asset) throw new Error('No video was selected.');
    const id = createId('clip');
    const extension = asset.name.split('.').at(-1)?.toLowerCase();
    const uri = `${directory()}${id}.${extension && /^[a-z0-9]{1,6}$/.test(extension) ? extension : 'mp4'}`;
    await FileSystem.makeDirectoryAsync(directory(), { intermediates: true });
    try {
      await FileSystem.copyAsync({ from: asset.uri, to: uri });
    } catch (error) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      throw error;
    }
    return { version: 1, id, uri, name: 'Rival', durationMs: 0, repTimesMs: [] };
  },
  async save(clip: VideoRivalClip): Promise<VideoRivalClip> {
    const valid = parseVideoRivalClip(clip);
    if (!valid || !owned(valid.uri) || !valid.repTimesMs.length)
      throw new Error('Add a name and pushup timings before saving.');
    if (!(await FileSystem.getInfoAsync(valid.uri)).exists)
      throw new Error('That video is no longer on this device. Choose it again.');
    const database = await getDatabase();
    await database.runAsync(
      'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
      KEY,
      JSON.stringify(valid),
    );
    return valid;
  },
  async discard(uri: string) {
    if (owned(uri)) await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};
