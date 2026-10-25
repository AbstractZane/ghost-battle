import {
  normalizeRepTimes,
  parseVideoRivalClip,
  type VideoRivalClip,
  type VideoRoundSnapshot,
} from './videoRival';

export interface GhostChallenge {
  version: 1;
  id: string;
  title: string;
  clip: VideoRivalClip;
  savedAt: string;
}
export function parseGhostChallenge(value: unknown): GhostChallenge | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<GhostChallenge>;
  const clip = parseVideoRivalClip(item.clip);
  if (
    item.version !== 1 ||
    !clip?.repTimesMs.length ||
    item.id !== clip.id ||
    typeof item.title !== 'string' ||
    !item.title.trim() ||
    item.title.length > 60 ||
    typeof item.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(item.savedAt))
  )
    return null;
  return { version: 1, id: clip.id, title: item.title.trim(), clip, savedAt: item.savedAt };
}

/** Editor tap spacing prevents accidental double marks; it is not a detector threshold. */
export function addGhostMarker(times: readonly number[], positionMs: number, durationMs: number) {
  const at = Math.round(positionMs);
  if (
    times.length >= 5000 ||
    !Number.isFinite(at) ||
    at <= 0 ||
    at > durationMs ||
    times.some((time) => Math.abs(time - at) < 150)
  )
    return [...times];
  return normalizeRepTimes([...times, at], durationMs);
}
export function ghostBattlePresentation(snapshot: VideoRoundSnapshot, durationMs: number) {
  const difference = snapshot.playerScore - snapshot.opponentScore;
  const margin = Math.abs(difference);
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, snapshot.elapsedMs / durationMs)) : 0;
  const total = snapshot.playerScore + snapshot.opponentScore;
  return {
    difference,
    margin,
    progress,
    share: total > 0 ? snapshot.playerScore / total : 0.5,
    result: difference > 0 ? 'WIN' : difference < 0 ? 'LOSS' : 'TIE',
    lead:
      difference > 0
        ? `YOU LEAD BY ${margin}`
        : difference < 0
          ? `GHOST LEADS BY ${margin}`
          : 'NECK AND NECK',
    marginLabel:
      difference === 0
        ? 'An exact tie. One more rep next time.'
        : `${difference > 0 ? 'Won' : 'Lost'} by ${margin} ${margin === 1 ? 'push-up' : 'push-ups'}`,
  };
}
