import { BLAZEPOSE_FULL, MOVENET_LIGHTNING } from './poseModels';
import type { PoseLandmarkName, PoseLandmarks, PoseResult } from './poseTypes';

export interface WebMoveNetKeypoint {
  x: number;
  y: number;
  score?: number;
  name?: string;
}

export interface WebBlazePoseKeypoint extends WebMoveNetKeypoint {
  z?: number;
}

const ORDERED_NAMES: readonly PoseLandmarkName[] = [
  'nose',
  'leftEye',
  'rightEye',
  'leftEar',
  'rightEar',
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

const COCO_NAMES: Readonly<Record<string, PoseLandmarkName>> = {
  nose: 'nose',
  left_eye: 'leftEye',
  right_eye: 'rightEye',
  left_ear: 'leftEar',
  right_ear: 'rightEar',
  left_shoulder: 'leftShoulder',
  right_shoulder: 'rightShoulder',
  left_elbow: 'leftElbow',
  right_elbow: 'rightElbow',
  left_wrist: 'leftWrist',
  right_wrist: 'rightWrist',
  left_hip: 'leftHip',
  right_hip: 'rightHip',
  left_knee: 'leftKnee',
  right_knee: 'rightKnee',
  left_ankle: 'leftAnkle',
  right_ankle: 'rightAnkle',
};

export function mapWebMoveNetPose(input: {
  keypoints: readonly WebMoveNetKeypoint[] | null | undefined;
  videoWidth: number;
  videoHeight: number;
  timestamp: number;
  inferenceLatencyMs: number;
  cameraFacing: 'front' | 'back';
}): PoseResult | null {
  if (!input.keypoints?.length || input.videoWidth <= 0 || input.videoHeight <= 0) return null;
  const geometryScale = Math.max(input.videoWidth, input.videoHeight);
  const landmarks: PoseLandmarks = {};
  input.keypoints.forEach((keypoint, index) => {
    const name = (keypoint.name ? COCO_NAMES[keypoint.name] : undefined) ?? ORDERED_NAMES[index];
    if (!name || !Number.isFinite(keypoint.x) || !Number.isFinite(keypoint.y)) return;
    landmarks[name] = {
      x: clamp(keypoint.x / geometryScale, 0, input.videoWidth / geometryScale),
      y: clamp(keypoint.y / geometryScale, 0, input.videoHeight / geometryScale),
      confidence: clamp01(keypoint.score ?? 0),
    };
  });
  if (!Object.keys(landmarks).length) return null;
  const freshLandmarks = (Object.keys(landmarks) as PoseLandmarkName[]).filter(
    (name) => (landmarks[name]?.confidence ?? 0) >= 0.18,
  );
  const leftCore = ['leftShoulder', 'leftElbow', 'leftWrist', 'leftHip'] as const;
  const rightCore = ['rightShoulder', 'rightElbow', 'rightWrist', 'rightHip'] as const;
  const bestFreshCore = Math.max(
    leftCore.filter((name) => freshLandmarks.includes(name)).length,
    rightCore.filter((name) => freshLandmarks.includes(name)).length,
  );
  return {
    timestamp: input.timestamp,
    landmarks,
    rawLandmarks: { ...landmarks },
    inferenceLatencyMs: input.inferenceLatencyMs,
    sourceWidth: input.videoWidth,
    sourceHeight: input.videoHeight,
    cameraFacing: input.cameraFacing,
    orientation: 'up',
    inputMirrored: false,
    displayMirrored: input.cameraFacing === 'front',
    poseModel: MOVENET_LIGHTNING,
    tracking: {
      signalQuality: bestFreshCore === 4 ? 'GOOD' : bestFreshCore >= 2 ? 'DEGRADED' : 'LOST',
      freshLandmarks,
      lastReliableTimestamp: freshLandmarks.length ? input.timestamp : null,
    },
  };
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Converts requestVideoFrameCallback's monotonic presentation time into an epoch capture time. */
export function webFrameTimestamp(
  presentationTime: number | undefined,
  timeOrigin: number,
  observedAt: number,
): number {
  if (!Number.isFinite(presentationTime) || !Number.isFinite(timeOrigin)) return observedAt;
  const candidate = timeOrigin + (presentationTime ?? 0);
  if (!Number.isFinite(candidate) || candidate < 0) return observedAt;
  return Math.min(observedAt, candidate);
}

export const WEB_MOVENET_LANDMARK_NAMES = ORDERED_NAMES;

/** Maps BlazePose's 33 landmarks into the exact 17-point normalized boundary
 * used by all exercise detectors. Extra face/hand/foot landmarks remain model
 * details and never leak into detector code. */
export function mapWebBlazePose(input: {
  keypoints: readonly WebBlazePoseKeypoint[] | null | undefined;
  keypoints3D: readonly WebBlazePoseKeypoint[] | null | undefined;
  videoWidth: number;
  videoHeight: number;
  timestamp: number;
  inferenceLatencyMs: number;
  cameraFacing: 'front' | 'back';
}): PoseResult | null {
  if (!input.keypoints?.length || input.videoWidth <= 0 || input.videoHeight <= 0) return null;
  const geometryScale = Math.max(input.videoWidth, input.videoHeight);
  const depthByName = new Map(
    input.keypoints3D
      ?.filter((keypoint) => keypoint.name && Number.isFinite(keypoint.z))
      .map((keypoint) => [keypoint.name as string, keypoint.z as number]) ?? [],
  );
  const landmarks: PoseLandmarks = {};
  input.keypoints.forEach((keypoint, index) => {
    const name = (keypoint.name ? COCO_NAMES[keypoint.name] : undefined) ?? ORDERED_NAMES[index];
    if (!name || !Number.isFinite(keypoint.x) || !Number.isFinite(keypoint.y)) return;
    const z = depthByName.get(keypoint.name ?? '');
    landmarks[name] = {
      x: clamp(keypoint.x / geometryScale, 0, input.videoWidth / geometryScale),
      y: clamp(keypoint.y / geometryScale, 0, input.videoHeight / geometryScale),
      confidence: clamp01(keypoint.score ?? 0),
      ...(z === undefined ? {} : { z }),
    };
  });
  if (!Object.keys(landmarks).length) return null;
  const freshLandmarks = (Object.keys(landmarks) as PoseLandmarkName[]).filter(
    (name) => (landmarks[name]?.confidence ?? 0) >= 0.18,
  );
  const leftCore = ['leftShoulder', 'leftElbow', 'leftWrist', 'leftHip'] as const;
  const rightCore = ['rightShoulder', 'rightElbow', 'rightWrist', 'rightHip'] as const;
  const bestFreshCore = Math.max(
    leftCore.filter((name) => freshLandmarks.includes(name)).length,
    rightCore.filter((name) => freshLandmarks.includes(name)).length,
  );
  return {
    timestamp: input.timestamp,
    landmarks,
    rawLandmarks: { ...landmarks },
    inferenceLatencyMs: input.inferenceLatencyMs,
    sourceWidth: input.videoWidth,
    sourceHeight: input.videoHeight,
    cameraFacing: input.cameraFacing,
    orientation: 'up',
    inputMirrored: false,
    displayMirrored: input.cameraFacing === 'front',
    poseModel: BLAZEPOSE_FULL,
    tracking: {
      signalQuality: bestFreshCore === 4 ? 'GOOD' : bestFreshCore >= 2 ? 'DEGRADED' : 'LOST',
      freshLandmarks,
      lastReliableTimestamp: freshLandmarks.length ? input.timestamp : null,
    },
  };
}
