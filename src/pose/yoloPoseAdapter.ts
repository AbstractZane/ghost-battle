import { YOLOXPOSE_TINY } from './poseModels';
import { DEFAULT_PUSHUP_RULES } from '@/exercises/pushup/pushupRules';
import type { PoseLandmarkName, PoseLandmarks, PoseResult } from './poseTypes';

const COCO_NAMES: readonly PoseLandmarkName[] = [
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

type Box = readonly [number, number, number, number];

export interface YoloPoseSample {
  capturedAt: number;
  sourceWidth: number;
  sourceHeight: number;
  inputMirrored: boolean;
  orientation: 'up' | 'down' | 'left' | 'right';
  inferenceLatencyMs: number;
  candidate: {
    score: number;
    secondScore: number;
    bbox: Box;
    landmarks: readonly number[];
  };
}

export type YoloPoseAdapterResult =
  | { kind: 'pose'; pose: PoseResult }
  | { kind: 'absent' | 'ambiguous' | 'identity-changed' | 'reacquiring'; invalidate: boolean };

/** Tracks one unambiguous person, without merging landmarks across identities. */
export class YoloPoseAdapter {
  private previousBox: Box | null = null;
  private reacquireBox: Box | null = null;
  private reacquireCount = 0;
  private previousTimestamp = 0;
  private lastReliableTimestamp = 0;

  reset(): void {
    this.clearTracking();
    this.previousTimestamp = 0;
  }

  private clearTracking(): void {
    this.previousBox = null;
    this.reacquireBox = null;
    this.reacquireCount = 0;
    this.lastReliableTimestamp = 0;
  }

  markAbsent(timestamp = Date.now()): boolean {
    const invalidate =
      this.previousBox !== null &&
      timestamp - this.lastReliableTimestamp > DEFAULT_PUSHUP_RULES.trackingGraceMs;
    if (invalidate) this.clearTracking();
    return invalidate;
  }

  process(
    sample: YoloPoseSample,
    facing: 'front' | 'back',
    displayMirrored: boolean,
  ): YoloPoseAdapterResult {
    const { candidate } = sample;
    const valid = validateSample(sample);
    if (!valid || sample.capturedAt <= this.previousTimestamp) {
      const invalidate = this.previousBox !== null;
      this.clearTracking();
      return { kind: 'absent', invalidate };
    }
    this.previousTimestamp = sample.capturedAt;
    if (candidate.score < 0.15) {
      const invalidate = this.markAbsent(sample.capturedAt);
      return { kind: 'absent', invalidate };
    }
    if (candidate.secondScore >= 0.15 && candidate.secondScore >= candidate.score * 0.5) {
      const invalidate = this.previousBox !== null;
      this.clearTracking();
      return { kind: 'ambiguous', invalidate };
    }
    if (this.previousBox && !samePerson(this.previousBox, candidate.bbox)) {
      this.previousBox = null;
      this.reacquireBox = candidate.bbox;
      this.reacquireCount = 1;
      return { kind: 'identity-changed', invalidate: true };
    }
    if (!this.previousBox && this.reacquireBox) {
      if (!samePerson(this.reacquireBox, candidate.bbox)) {
        this.reacquireBox = candidate.bbox;
        this.reacquireCount = 1;
      } else {
        this.reacquireCount++;
      }
      if (this.reacquireCount < 3) return { kind: 'reacquiring', invalidate: false };
      this.reacquireBox = null;
    }
    this.previousBox = candidate.bbox;
    this.lastReliableTimestamp = sample.capturedAt;
    const rawLandmarks: PoseLandmarks = {};
    const landmarks: PoseLandmarks = {};
    const geometryScale = Math.max(sample.sourceWidth, sample.sourceHeight);
    const sourceSpanX = sample.sourceWidth / geometryScale;
    const sourceSpanY = sample.sourceHeight / geometryScale;
    for (let index = 0; index < COCO_NAMES.length; index++) {
      const name = COCO_NAMES[index]!;
      const x = candidate.landmarks[index * 3] ?? 0;
      const y = candidate.landmarks[index * 3 + 1] ?? 0;
      const confidence = candidate.landmarks[index * 3 + 2] ?? 0;
      const raw = {
        x: Math.min(sourceSpanX, Math.max(0, x * sourceSpanX)),
        y: Math.min(sourceSpanY, Math.max(0, y * sourceSpanY)),
        confidence,
      };
      rawLandmarks[name] = raw;
      landmarks[name] = { ...raw, x: sample.inputMirrored ? sourceSpanX - raw.x : raw.x };
    }
    const freshLandmarks = COCO_NAMES.filter((name) => (landmarks[name]?.confidence ?? 0) >= 0.18);
    return {
      kind: 'pose',
      pose: {
        timestamp: sample.capturedAt,
        landmarks,
        rawLandmarks,
        inferenceLatencyMs: sample.inferenceLatencyMs,
        sourceWidth: sample.sourceWidth,
        sourceHeight: sample.sourceHeight,
        cameraFacing: facing,
        orientation: sample.orientation,
        inputMirrored: sample.inputMirrored,
        displayMirrored,
        poseModel: YOLOXPOSE_TINY,
        tracking: {
          signalQuality: 'GOOD',
          freshLandmarks,
          lastReliableTimestamp: sample.capturedAt,
        },
      },
    };
  }
}

export function parseYoloPoseSample(
  raw: string,
): YoloPoseSample | 'ready' | 'error' | 'absent' | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.state === 'ready' || value.state === 'error') return value.state;
  if (value.state !== 'pose' || !isRecord(value.candidate)) return null;
  const candidate = value.candidate;
  if (candidate.score === 0) return 'absent';
  const bbox = candidate.bbox;
  const landmarks = candidate.landmarks;
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every(isFiniteNumber) ||
    !Array.isArray(landmarks) ||
    landmarks.length !== 51 ||
    !landmarks.every(isFiniteNumber) ||
    !isFiniteNumber(candidate.score) ||
    !isFiniteNumber(candidate.secondScore) ||
    !isFiniteNumber(value.capturedAt) ||
    !isFiniteNumber(value.sourceWidth) ||
    !isFiniteNumber(value.sourceHeight) ||
    !isFiniteNumber(value.inferenceLatencyMs) ||
    typeof value.inputMirrored !== 'boolean' ||
    !isOrientation(value.orientation)
  )
    return null;
  return {
    capturedAt: value.capturedAt,
    sourceWidth: value.sourceWidth,
    sourceHeight: value.sourceHeight,
    inputMirrored: value.inputMirrored,
    orientation: value.orientation,
    inferenceLatencyMs: value.inferenceLatencyMs,
    candidate: {
      score: candidate.score,
      secondScore: candidate.secondScore,
      bbox: bbox as unknown as Box,
      landmarks,
    },
  };
}

function validateSample(sample: YoloPoseSample): boolean {
  return (
    sample.sourceWidth > 0 &&
    sample.sourceHeight > 0 &&
    sample.inferenceLatencyMs >= 0 &&
    sample.candidate.landmarks.length === 51 &&
    sample.candidate.landmarks.every(isFiniteNumber) &&
    sample.candidate.bbox.every((part) => Number.isFinite(part) && part >= 0 && part <= 1)
  );
}

function samePerson(a: Box, b: Box): boolean {
  const centerDistance = Math.hypot(
    (a[0] + a[2] - b[0] - b[2]) / 2,
    (a[1] + a[3] - b[1] - b[3]) / 2,
  );
  const sizeA = Math.hypot(a[2] - a[0], a[3] - a[1]);
  const sizeB = Math.hypot(b[2] - b[0], b[3] - b[1]);
  return centerDistance <= Math.max(0.12, Math.max(sizeA, sizeB) * 0.35);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isOrientation(value: unknown): value is YoloPoseSample['orientation'] {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}
