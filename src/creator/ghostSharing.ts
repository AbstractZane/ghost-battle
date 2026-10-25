import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { MAX_GHOST_BYTES } from './ghostMotion';
import { parseGhostFile, exportGhostFile } from './ghostPackage';
import type { VideoRivalClip } from './videoRival';
export async function shareGhost(clip: VideoRivalClip, title: string) {
  const data = exportGhostFile(clip, title);
  if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync()))
    throw new Error('Sharing is unavailable on this device.');
  const uri = `${FileSystem.cacheDirectory}ghost-${clip.id}.ghost.json`;
  await FileSystem.writeAsStringAsync(uri, data);
  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: 'Share motion ghost · no video or audio',
    });
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}
export async function importGhost() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'application/octet-stream', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset || (asset.size !== undefined && asset.size > MAX_GHOST_BYTES))
    throw new Error('Choose a Ghost Battle file under 5 MB.');
  try {
    const info = await FileSystem.getInfoAsync(asset.uri);
    if (!info.exists || info.size > MAX_GHOST_BYTES)
      throw new Error('Choose a Ghost Battle file under 5 MB.');
    return parseGhostFile(await FileSystem.readAsStringAsync(asset.uri));
  } finally {
    // Only the picker-owned cache copy is temporary; never remove the user's original.
    if (FileSystem.cacheDirectory && asset.uri.startsWith(FileSystem.cacheDirectory))
      await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => undefined);
  }
}
