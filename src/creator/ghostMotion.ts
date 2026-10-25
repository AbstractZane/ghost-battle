import type { PoseLandmarkName, PoseResult } from '@/pose/poseTypes';

export const MOTION_JOINTS: readonly PoseLandmarkName[] = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];
export const MAX_ANALYSIS_MS = 300_000;
export const MAX_GHOST_BYTES = 5 * 1024 * 1024;
export type MotionJoint = readonly [number, number, number] | null;
export interface GhostMotionFrame {
  atMs: number;
  joints: MotionJoint[];
}
export interface GhostMotionTrack {
  version: 1;
  durationMs: number;
  aspectRatio: number;
  frames: GhostMotionFrame[];
}
export interface GhostAnalysisResult {
  version: 1;
  motion: GhostMotionTrack;
  repTimesMs: number[];
  gaps: { fromMs: number; toMs: number }[];
  reviewed: boolean;
  method: 'detector' | 'edited';
}
export function parseMotionTrack(value: unknown): GhostMotionTrack | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<GhostMotionTrack>;
  if (
    v.version !== 1 ||
    !Number.isInteger(v.durationMs) ||
    v.durationMs! < 1000 ||
    v.durationMs! > MAX_ANALYSIS_MS ||
    !Number.isFinite(v.aspectRatio) ||
    v.aspectRatio! < 0.1 ||
    v.aspectRatio! > 10 ||
    !Array.isArray(v.frames) ||
    !v.frames.length ||
    v.frames.length > 4600
  )
    return null;
  let previous = -1;
  const frames: GhostMotionFrame[] = [];
  for (const frame of v.frames) {
    if (
      !frame ||
      !Number.isInteger(frame.atMs) ||
      frame.atMs <= previous ||
      frame.atMs < 0 ||
      frame.atMs > v.durationMs! ||
      !Array.isArray(frame.joints) ||
      frame.joints.length !== MOTION_JOINTS.length
    )
      return null;
    const joints: MotionJoint[] = [];
    for (const joint of frame.joints) {
      if (joint === null) {
        joints.push(null);
        continue;
      }
      if (
        !Array.isArray(joint) ||
        joint.length !== 3 ||
        !joint.every(Number.isInteger) ||
        joint[0] < 0 ||
        joint[0] > 10000 ||
        joint[1] < 0 ||
        joint[1] > 10000 ||
        joint[2] < 0 ||
        joint[2] > 1000
      )
        return null;
      joints.push([joint[0], joint[1], joint[2]]);
    }
    frames.push({ atMs: frame.atMs, joints });
    previous = frame.atMs;
  }
  return { version: 1, durationMs: v.durationMs!, aspectRatio: v.aspectRatio!, frames };
}
export function motionFrame(pose: PoseResult | null, atMs: number): GhostMotionFrame {
  return {
    atMs,
    joints: MOTION_JOINTS.map((name) => {
      const p = pose?.landmarks[name];
      return p &&
        p.confidence >= 0.18 &&
        (!pose?.tracking || pose.tracking.freshLandmarks.includes(name))
        ? ([
            Math.round(Math.max(0, Math.min(1, p.x)) * 10000),
            Math.round(Math.max(0, Math.min(1, p.y)) * 10000),
            Math.round(Math.max(0, Math.min(1, p.confidence)) * 1000),
          ] as const)
        : null;
    }),
  };
}
/** Interpolation is display-only, and never crosses a missing joint or a tracking gap. */
export function motionAt(track: GhostMotionTrack, atMs: number): MotionJoint[] {
  let lo = 0,
    hi = track.frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track.frames[mid]!.atMs <= atMs) lo = mid + 1;
    else hi = mid;
  }
  const a = track.frames[lo - 1],
    b = track.frames[lo];
  if (!a || atMs - a.atMs > 200) return MOTION_JOINTS.map(() => null);
  if (!b || b.atMs - a.atMs > 200) return a.joints;
  const t = (atMs - a.atMs) / (b.atMs - a.atMs);
  return a.joints.map((p, i) => {
    const q = b.joints[i];
    return p && q
      ? [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, Math.min(p[2], q[2])]
      : null;
  });
}
