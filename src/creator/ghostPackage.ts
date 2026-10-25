import { parseMotionTrack, MAX_GHOST_BYTES, type GhostMotionTrack } from './ghostMotion';
import { normalizeRepTimes, type VideoRivalClip } from './videoRival';

export interface GhostChallengeFile {
  format: 'ghost-battle-motion';
  version: 1;
  name: string;
  title: string;
  durationMs: number;
  repTimesMs: number[];
  motion: GhostMotionTrack;
  marking: 'detector' | 'edited';
}
export function parseGhostFile(text: string): GhostChallengeFile {
  if (text.length > MAX_GHOST_BYTES || unescape(encodeURIComponent(text)).length > MAX_GHOST_BYTES)
    throw new Error('Ghost files must be smaller than 5 MB.');
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('This is not a Ghost Battle challenge.');
  const v = raw as Partial<GhostChallengeFile>;
  const motion = parseMotionTrack(v.motion);
  if (
    v.format !== 'ghost-battle-motion' ||
    v.version !== 1 ||
    !motion ||
    motion.durationMs !== v.durationMs ||
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 32 ||
    typeof v.title !== 'string' ||
    !v.title.trim() ||
    v.title.length > 60 ||
    (v.marking !== 'detector' && v.marking !== 'edited')
  )
    throw new Error('The ghost file is invalid or uses an unsupported version.');
  const repTimesMs = normalizeRepTimes(v.repTimesMs, motion.durationMs);
  if (!repTimesMs.length) throw new Error('This ghost has no confirmed reps.');
  // Explicit field selection strips every unknown field, including paths and personal media.
  return {
    format: 'ghost-battle-motion',
    version: 1,
    name: v.name.trim(),
    title: v.title.trim(),
    durationMs: motion.durationMs,
    repTimesMs,
    motion,
    marking: v.marking,
  };
}
export function exportGhostFile(clip: VideoRivalClip, title: string): string {
  if (!clip.motion || !clip.analysisReviewed)
    throw new Error('Analyze the video and confirm its markers before sharing a motion ghost.');
  const json = JSON.stringify({
    format: 'ghost-battle-motion',
    version: 1,
    title,
    name: clip.name,
    durationMs: clip.durationMs,
    repTimesMs: clip.repTimesMs,
    motion: clip.motion,
    marking: clip.marking ?? 'edited',
  });
  return JSON.stringify(parseGhostFile(json));
}
