import * as DocumentPicker from 'expo-document-picker';
import { browserStore } from './browserStore';
import { parseStudioProfiles, type StudioProfiles } from './studioProfiles';
export const studioProfilesRepository = {
  async load(): Promise<StudioProfiles | null> {
    return parseStudioProfiles(await browserStore.read('players'));
  },
  async pickPhoto(): Promise<string | null> {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/jpeg', 'image/png', 'image/webp'],
      multiple: false,
      base64: false,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset?.file || !/^image\/(jpeg|png|webp)$/.test(asset.file.type))
      throw new Error('Choose a JPG, PNG, or WebP photo.');
    try {
      if (asset.file.size > 12 * 1024 * 1024) throw new Error('Choose a photo smaller than 12 MB.');
      const bitmap = await createImageBitmap(asset.file);
      const valid =
        bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= 100_000_000;
      bitmap.close();
      if (!valid) throw new Error('Choose a smaller image.');
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('That photo could not open.'));
        reader.onerror = () => reject(new Error('That photo could not open.'));
        reader.readAsDataURL(asset.file!);
      });
    } finally {
      URL.revokeObjectURL(asset.uri);
    }
  },
  async save(profiles: StudioProfiles): Promise<StudioProfiles> {
    const valid = parseStudioProfiles(profiles);
    if (!valid) throw new Error('Enter a name for both players, up to 32 characters.');
    await browserStore.write('players', valid);
    return valid;
  },
  discardPhoto(): Promise<void> {
    /* Draft data URLs are garbage collected; no shared image file is deleted. */
    return Promise.resolve();
  },
};
