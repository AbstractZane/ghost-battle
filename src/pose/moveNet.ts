import type { PoseLandmarkName, PoseLandmarks, PoseResult } from './poseTypes';
import type { MoveNetInputTransform } from './frameConversion';
import type { PoseModelId } from './poseModels';

export interface PoseFrameMetadata {
  sourceWidth: number;
  sourceHeight: number;
  cameraFacing: 'front' | 'back';
  orientation: 'up' | 'down' | 'left' | 'right';
  inputMirrored: boolean;
  displayMirrored: boolean;
  poseModel: PoseModelId;
}

const MOVE_NET_LANDMARKS: Array<PoseLandmarkName | null> = [
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

export function normalizeMoveNetOutput(
  output: ReadonlyArray<number>,
  timestamp: number,
  inferenceLatencyMs: number,
  metadata: PoseFrameMetadata,
  transform?: MoveNetInputTransform,
): PoseResult | null {
  if (output.length < 51) return null;
  const rawLandmarks: PoseLandmarks = {};
  const landmarks: PoseLandmarks = {};
  const geometryScale = Math.max(metadata.sourceWidth, metadata.sourceHeight);
  if (geometryScale <= 0) return null;
  const sourceSpanX = metadata.sourceWidth / geometryScale;
  const sourceSpanY = metadata.sourceHeight / geometryScale;
  for (let index = 0; index < MOVE_NET_LANDMARKS.length; index += 1) {
    const name = MOVE_NET_LANDMARKS[index];
    if (!name) continue;
    const offset = index * 3;
    const y = output[offset];
    const x = output[offset + 1];
    const confidence = output[offset + 2];
    if (x === undefined || y === undefined || confidence === undefined) continue;
    const sourceX = transform
      ? (x * transform.inputWidth - transform.padX) / transform.contentWidth
      : x;
    const sourceY = transform
      ? (y * transform.inputHeight - transform.padY) / transform.contentHeight
      : y;
    const raw = {
      x: Math.max(0, Math.min(sourceSpanX, (sourceX * metadata.sourceWidth) / geometryScale)),
      y: Math.max(0, Math.min(sourceSpanY, (sourceY * metadata.sourceHeight) / geometryScale)),
      confidence,
    };
    rawLandmarks[name] = raw;
    landmarks[name] = {
      ...raw,
      x: metadata.inputMirrored ? sourceSpanX - raw.x : raw.x,
    };
  }
  return {
    timestamp,
    rawLandmarks,
    landmarks,
    inferenceLatencyMs,
    ...metadata,
    tracking: {
      signalQuality: 'GOOD',
      freshLandmarks: (Object.keys(landmarks) as PoseLandmarkName[]).filter(
        (name) => (landmarks[name]?.confidence ?? 0) >= 0.18,
      ),
      lastReliableTimestamp: timestamp,
    },
  };
}
