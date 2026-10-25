import { clipRepository } from './clipRepository';
import { ghostPersistence } from './ghostPersistence';
import { parseGhostChallenge, type GhostChallenge } from './ghostChallenges';
import type { VideoRivalClip } from './videoRival';

const KEY = 'ghost_battle_library_v1';
// Serialize local read/modify/write commands, including simultaneous saves/removes.
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action, action);
  pending = result.catch(() => undefined);
  return result;
}
async function read(): Promise<GhostChallenge[]> {
  const raw = await ghostPersistence.read(KEY);
  if (raw === null) {
    const old = await clipRepository.load().catch(() => null);
    const migrated: GhostChallenge[] = old
      ? [
          {
            version: 1,
            id: old.id,
            title: `${old.name}'s ghost`,
            clip: old,
            savedAt: new Date().toISOString(),
          },
        ]
      : [];
    await write(migrated);
    return migrated;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Your challenge library could not load. Your videos have not been deleted.');
  }
  if (!Array.isArray(parsed)) throw new Error('Your challenge library could not load.');
  const entries = parsed.map((value: unknown) => parseGhostChallenge(value));
  if (entries.some((entry) => !entry))
    throw new Error('A saved challenge could not be read. Your videos have not been deleted.');
  return entries.filter((entry): entry is GhostChallenge => entry !== null);
}
async function write(entries: GhostChallenge[]) {
  await ghostPersistence.write(KEY, JSON.stringify(entries));
}
export const ghostChallengeRepository = {
  list: () => serial(read),
  save: (clip: VideoRivalClip, title: string) =>
    serial(async () => {
      const resolved = await clipRepository.resolve(clip);
      if (!resolved) throw new Error('This video is missing. Choose it again before saving.');
      const valid = parseGhostChallenge({
        version: 1,
        id: clip.id,
        title,
        clip: resolved,
        savedAt: new Date().toISOString(),
      });
      if (!valid) throw new Error('Add a challenge name and at least one completed-rep timestamp.');
      const entries = await read();
      const existing = entries.find((entry) => entry.id === valid.id);
      // Keep identity/order stable on edits; saving does not retire other challenges.
      if (existing) valid.savedAt = existing.savedAt;
      await write([valid, ...entries.filter((entry) => entry.id !== valid.id)]);
      return valid;
    }),
  async open(entry: GhostChallenge): Promise<VideoRivalClip> {
    const clip = await clipRepository.resolve(entry.clip);
    if (!clip) throw new Error('This video is no longer available. Import it again to race.');
    return clip;
  },
  remove: (id: string) =>
    serial(async () => {
      const entries = await read();
      // Preserve the explicit imported file. Deleting shared/selected media is a separate action.
      await write(entries.filter((entry) => entry.id !== id));
    }),
};
