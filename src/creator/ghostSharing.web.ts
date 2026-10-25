import * as DocumentPicker from 'expo-document-picker';
import { MAX_GHOST_BYTES } from './ghostMotion';
import { parseGhostFile, exportGhostFile } from './ghostPackage';
import type { VideoRivalClip } from './videoRival';
export function shareGhost(clip: VideoRivalClip, title: string) {
  const blob = new Blob([exportGhostFile(clip, title)], { type: 'application/json' });
  const uri = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = uri;
  link.download = `${clip.id}.ghost.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(uri), 1000);
  return Promise.resolve();
}
export async function importGhost() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'application/octet-stream', 'text/plain'],
    base64: false,
  });
  if (result.canceled) return null;
  const file = result.assets[0]?.file;
  if (!file || file.size > MAX_GHOST_BYTES)
    throw new Error('Choose a Ghost Battle file under 5 MB.');
  return parseGhostFile(await file.text());
}
