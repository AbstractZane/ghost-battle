import * as tf from '@tensorflow/tfjs';
import { HYBRID_PUSHUP_RULES } from '@/exercises/pushup/pushupRules';

import type { PoseLandmarkName, PoseResult } from '@/pose/poseTypes';

const LANDMARK_NAMES: ReadonlyArray<PoseLandmarkName> = [
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

interface LocalLandmark {
  x: number;
  y: number;
  confidence: number;
}

interface LocalFrame {
  landmarks: LocalLandmark[];
}

/** ML V1 was trained on independently normalized axes; PoseResult is isotropic. */
export function mlV1PoseFrame(pose: PoseResult): LocalFrame {
  const scale = Math.max(pose.sourceWidth, pose.sourceHeight);
  if (pose.sourceWidth <= 0 || pose.sourceHeight <= 0 || !Number.isFinite(scale)) {
    throw new Error('ML V1 requires valid source dimensions.');
  }
  return {
    landmarks: LANDMARK_NAMES.map((name) => {
      const landmark = pose.landmarks[name];
      return landmark
        ? {
            x: (landmark.x * scale) / pose.sourceWidth,
            y: (landmark.y * scale) / pose.sourceHeight,
            confidence: landmark.confidence,
          }
        : { x: 0.5, y: 0.5, confidence: 0 };
    }),
  };
}

interface LocalArtifact {
  format: 'pushpvp-tfjs-layers-v1';
  modelTopology: object;
  weights: Array<{ shape: number[]; values: number[] }>;
  metadata: {
    modelVersion: string;
    featureCount: number;
    windowLength: number;
    datasetLicense: string;
    commercialUseAllowed: boolean;
    purpose: string;
    decisionThreshold: number;
    normalization: { mean: number[]; standardDeviation: number[] };
  };
}

export interface MlV1LocalDiagnostics {
  state: 'not-loaded' | 'loading' | 'ready' | 'error';
  validProbability: number | null;
  invalidProbability: number | null;
  decision: 'VALID' | 'INVALID' | 'WAITING';
  windowLength: number;
  framesCollected: number;
  error: string | null;
}

function midpoint(
  left: LocalLandmark | undefined,
  right: LocalLandmark | undefined,
): { x: number; y: number } | null {
  const usable = [left, right].filter((landmark): landmark is LocalLandmark =>
    Boolean(landmark && landmark.confidence >= 0.1),
  );
  if (!usable.length) return null;
  return {
    x: usable.reduce((sum, landmark) => sum + landmark.x, 0) / usable.length,
    y: usable.reduce((sum, landmark) => sum + landmark.y, 0) / usable.length,
  };
}

function normalizeFrame(frame: LocalFrame): number[] {
  const leftShoulder = frame.landmarks[5];
  const rightShoulder = frame.landmarks[6];
  const leftHip = frame.landmarks[11];
  const rightHip = frame.landmarks[12];
  const shoulders = midpoint(leftShoulder, rightShoulder);
  const hips = midpoint(leftHip, rightHip);
  const center = hips ?? shoulders ?? { x: 0.5, y: 0.5 };
  const torsoScale = shoulders && hips ? Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) : 0;
  const shoulderScale =
    leftShoulder && rightShoulder
      ? Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y)
      : 0;
  const scale = Math.max(torsoScale, shoulderScale, 0.05);
  return frame.landmarks.flatMap((landmark) => [
    (landmark.x - center.x) / scale,
    (landmark.y - center.y) / scale,
    landmark.confidence,
  ]);
}

function features(frames: ReadonlyArray<LocalFrame>): number[][] {
  let previous: number[] | null = null;
  return frames.map((frame) => {
    const normalized = normalizeFrame(frame);
    const velocity = normalized.flatMap((value, index) =>
      index % 3 === 2 ? [] : [previous ? value - (previous[index] ?? value) : 0],
    );
    previous = normalized;
    return [...normalized, ...velocity];
  });
}

function parseArtifact(value: string): LocalArtifact {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') throw new Error('Model file must contain JSON.');
  const artifact = parsed as Partial<LocalArtifact>;
  if (
    artifact.format !== 'pushpvp-tfjs-layers-v1' ||
    !artifact.metadata ||
    !artifact.modelTopology
  ) {
    throw new Error('Unsupported ML V1 model file.');
  }
  if (
    artifact.metadata.commercialUseAllowed !== false ||
    artifact.metadata.purpose !== 'research-and-development' ||
    !artifact.metadata.datasetLicense
  ) {
    throw new Error('Only explicitly non-commercial R&D model artifacts can be loaded.');
  }
  if (!Array.isArray(artifact.weights) || artifact.metadata.featureCount !== 85) {
    throw new Error('ML V1 model feature schema is incompatible.');
  }
  return artifact as LocalArtifact;
}

export class MlV1LocalValidator {
  private artifact: LocalArtifact | null = null;
  private model: tf.LayersModel | null = null;
  private frames: LocalFrame[] = [];
  private scoring = false;
  private lastSampleAt: number | null = null;

  async load(serialized: string): Promise<void> {
    const artifact = parseArtifact(serialized);
    await tf.ready();
    const model = await tf.models.modelFromJSON({
      modelTopology: artifact.modelTopology,
    } as tf.io.ModelJSON);
    const tensors = artifact.weights.map((weight) => tf.tensor(weight.values, weight.shape));
    model.setWeights(tensors);
    tensors.forEach((tensor) => tensor.dispose());
    this.model?.dispose();
    this.model = model;
    this.artifact = artifact;
    this.frames = [];
    this.lastSampleAt = null;
  }

  async addPose(pose: PoseResult): Promise<Omit<MlV1LocalDiagnostics, 'state' | 'error'>> {
    const artifact = this.artifact;
    const model = this.model;
    if (!artifact || !model) {
      return {
        validProbability: null,
        invalidProbability: null,
        decision: 'WAITING',
        windowLength: 0,
        framesCollected: 0,
      };
    }
    if (
      this.lastSampleAt !== null &&
      pose.timestamp - this.lastSampleAt > HYBRID_PUSHUP_RULES.trackingGraceMs
    ) {
      this.frames = [];
    }
    const sampleDue =
      this.lastSampleAt === null ||
      pose.timestamp - this.lastSampleAt >= HYBRID_PUSHUP_RULES.modelSampleIntervalMs;
    if (sampleDue) {
      this.frames.push(mlV1PoseFrame(pose));
      this.lastSampleAt = pose.timestamp;
    }
    this.frames = this.frames.slice(-artifact.metadata.windowLength);
    if (!sampleDue || this.frames.length < artifact.metadata.windowLength || this.scoring) {
      return {
        validProbability: null,
        invalidProbability: null,
        decision: 'WAITING',
        windowLength: artifact.metadata.windowLength,
        framesCollected: this.frames.length,
      };
    }
    this.scoring = true;
    try {
      const validProbability = await this.scoreFrames(this.frames, artifact, model);
      return {
        validProbability,
        invalidProbability: 1 - validProbability,
        decision: validProbability >= artifact.metadata.decisionThreshold ? 'VALID' : 'INVALID',
        windowLength: artifact.metadata.windowLength,
        framesCollected: this.frames.length,
      };
    } finally {
      this.scoring = false;
    }
  }

  async scorePoseWindow(
    poses: ReadonlyArray<PoseResult>,
  ): Promise<Omit<MlV1LocalDiagnostics, 'state' | 'error'>> {
    const artifact = this.artifact;
    const model = this.model;
    if (!artifact || !model || poses.length === 0) {
      return {
        validProbability: null,
        invalidProbability: null,
        decision: 'WAITING',
        windowLength: artifact?.metadata.windowLength ?? 0,
        framesCollected: poses.length,
      };
    }
    const local = poses.map(mlV1PoseFrame);
    const frames = Array.from(
      { length: artifact.metadata.windowLength },
      (_, index) => local[Math.min(local.length - 1, index)],
    ).filter((frame): frame is LocalFrame => frame !== undefined);
    const validProbability = await this.scoreFrames(frames, artifact, model);
    return {
      validProbability,
      invalidProbability: 1 - validProbability,
      decision: validProbability >= artifact.metadata.decisionThreshold ? 'VALID' : 'INVALID',
      windowLength: artifact.metadata.windowLength,
      framesCollected: frames.length,
    };
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
    this.artifact = null;
    this.frames = [];
    this.lastSampleAt = null;
  }

  private async scoreFrames(
    frames: ReadonlyArray<LocalFrame>,
    artifact: LocalArtifact,
    model: tf.LayersModel,
  ): Promise<number> {
    const normalized = features(frames).map((frame) =>
      frame.map(
        (value, index) =>
          (value - (artifact.metadata.normalization.mean[index] ?? 0)) /
          (artifact.metadata.normalization.standardDeviation[index] ?? 1),
      ),
    );
    const input = tf.tensor3d(normalized.flat(), [
      1,
      artifact.metadata.windowLength,
      artifact.metadata.featureCount,
    ]);
    const prediction = model.predict(input) as tf.Tensor;
    const validProbability = (await prediction.data())[0] ?? 0;
    input.dispose();
    prediction.dispose();
    return validProbability;
  }
}

export function chooseLocalMlV1ModelFile(): Promise<string> {
  if (typeof document === 'undefined')
    return Promise.reject(new Error('Web file picker unavailable.'));
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No model file selected.'));
        return;
      }
      void file.text().then(resolve, reject);
    };
    input.click();
  });
}
