import * as DocumentPicker from 'expo-document-picker';
import { createId } from '@/utils/format';
import { browserStore } from './browserStore';
import { parseVideoRivalClip, type VideoRivalClip } from './videoRival';

interface VideoRecord {
  blob: Blob;
  clip: VideoRivalClip;
}
const urls = new Map<string, string>();
function record(value: unknown): VideoRecord | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<VideoRecord>;
  return item.blob instanceof Blob && item.clip && typeof item.clip.id === 'string'
    ? { blob: item.blob, clip: item.clip }
    : null;
}
function mediaUrl(id: string, blob: Blob) {
  let uri = urls.get(id);
  if (!uri) {
    uri = URL.createObjectURL(blob);
    urls.set(id, uri);
  }
  return uri;
}
export const clipRepository = {
  async resolve(clip: VideoRivalClip): Promise<VideoRivalClip | null> {
    const saved = record(await browserStore.read(`video:${clip.id}`));
    if (!saved) return null;
    return parseVideoRivalClip({ ...clip, uri: mediaUrl(clip.id, saved.blob) });
  },
  async load(): Promise<VideoRivalClip | null> {
    const id = await browserStore.read('active-video');
    if (typeof id !== 'string') return null;
    const saved = record(await browserStore.read(`video:${id}`));
    if (!saved) throw new Error('That video is missing. Choose it again.');
    const clip = await this.resolve(saved.clip);
    if (!clip) throw new Error('Your saved video setup could not load.');
    return clip;
  },
  async pick(): Promise<VideoRivalClip | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'video/*',
      multiple: false,
      base64: false,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset?.file) throw new Error('Choose a video from this device.');
    const id = createId('ghost');
    const clip: VideoRivalClip = {
      version: 1,
      id,
      uri: asset.uri,
      name: 'Ghost',
      durationMs: 0,
      repTimesMs: [],
    };
    try {
      await browserStore.write(`video:${id}`, { blob: asset.file, clip });
      urls.set(id, asset.uri);
      return clip;
    } catch (error) {
      URL.revokeObjectURL(asset.uri);
      throw error;
    }
  },
  async save(clip: VideoRivalClip): Promise<VideoRivalClip> {
    const valid = parseVideoRivalClip(clip);
    if (!valid?.repTimesMs.length) throw new Error('Add completed-rep timestamps before saving.');
    const saved = record(await browserStore.read(`video:${valid.id}`));
    if (!saved) throw new Error('That video is missing. Choose it again.');
    const resolved = { ...valid, uri: mediaUrl(valid.id, saved.blob) };
    await browserStore.write(`video:${valid.id}`, { blob: saved.blob, clip: resolved });
    await browserStore.write('active-video', valid.id);
    return resolved;
  },
  async discard(uri: string): Promise<void> {
    for (const [id, owned] of urls) {
      if (owned !== uri) continue;
      await browserStore.remove(`video:${id}`);
      URL.revokeObjectURL(owned);
      urls.delete(id);
      return;
    }
  },
};
