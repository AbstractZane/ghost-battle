import type {
  PoseLandmark,
  PoseLandmarkName,
  PoseLandmarks,
  PosePipelineFrame,
  PoseResult,
} from './poseTypes';

export interface PoseEngineV3Options {
  confidenceFloor: number;
  detectorStillAlpha: number;
  detectorMotionAlpha: number;
  displayStillAlpha: number;
  displayMotionAlpha: number;
  motionDistance: number;
  outlierDistance: number;
  detectorPredictionMs: number;
  displayPredictionMs: number;
  signalGraceMs: number;
}

const DEFAULT_OPTIONS: Readonly<PoseEngineV3Options> = {
  confidenceFloor: 0.18,
  detectorStillAlpha: 0.78,
  detectorMotionAlpha: 0.96,
  displayStillAlpha: 0.32,
  displayMotionAlpha: 0.82,
  motionDistance: 0.035,
  outlierDistance: 0.22,
  detectorPredictionMs: 180,
  displayPredictionMs: 300,
  signalGraceMs: 600,
};

interface JointTrack {
  detector: PoseLandmark;
  display: PoseLandmark;
  velocityX: number;
  velocityY: number;
  lastValidTimestamp: number;
  rejectedCandidate?: PoseLandmark;
  rejectedCount: number;
}

const JOINT_NAMES: ReadonlyArray<PoseLandmarkName> = [
  'nose',
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

const NEIGHBORS: Partial<Record<PoseLandmarkName, ReadonlyArray<PoseLandmarkName>>> = {
  leftShoulder: ['leftElbow', 'leftHip', 'rightShoulder'],
  rightShoulder: ['rightElbow', 'rightHip', 'leftShoulder'],
  leftElbow: ['leftShoulder', 'leftWrist'],
  rightElbow: ['rightShoulder', 'rightWrist'],
  leftWrist: ['leftElbow'],
  rightWrist: ['rightElbow'],
  leftHip: ['leftShoulder', 'leftKnee', 'rightHip'],
  rightHip: ['rightShoulder', 'rightKnee', 'leftHip'],
  leftKnee: ['leftHip', 'leftAnkle'],
  rightKnee: ['rightHip', 'rightAnkle'],
  leftAnkle: ['leftKnee'],
  rightAnkle: ['rightKnee'],
};

const BONES: ReadonlyArray<readonly [PoseLandmarkName, PoseLandmarkName]> = [
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];

const LEFT_CORE: ReadonlyArray<PoseLandmarkName> = [
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'leftHip',
];
const RIGHT_CORE: ReadonlyArray<PoseLandmarkName> = [
  'rightShoulder',
  'rightElbow',
  'rightWrist',
  'rightHip',
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function blend(previous: PoseLandmark, current: PoseLandmark, alpha: number): PoseLandmark {
  return {
    x: previous.x + (current.x - previous.x) * alpha,
    y: previous.y + (current.y - previous.y) * alpha,
    z:
      previous.z === undefined || current.z === undefined
        ? current.z
        : previous.z + (current.z - previous.z) * alpha,
    confidence: previous.confidence + (current.confidence - previous.confidence) * alpha,
  };
}

function predict(track: JointTrack, timestamp: number, windowMs: number): PoseLandmark | undefined {
  const elapsedMs = timestamp - track.lastValidTimestamp;
  if (elapsedMs < 0 || elapsedMs > windowMs) return undefined;
  const seconds = Math.min(elapsedMs, 120) / 1000;
  const confidenceFade = 1 - elapsedMs / Math.max(1, windowMs);
  return {
    x: clamp(track.detector.x + track.velocityX * seconds, 0, 1),
    y: clamp(track.detector.y + track.velocityY * seconds, 0, 1),
    z: track.detector.z,
    confidence: track.detector.confidence * confidenceFade,
  };
}

function copyPose(result: PoseResult, landmarks: PoseLandmarks): PoseResult {
  return { ...result, landmarks };
}

/**
 * Canonical temporal pose tracker with independent detector and display filters.
 * It never consumes or emits preview-projected coordinates.
 */
export class PoseEngineV3 {
  private readonly tracks: Partial<Record<PoseLandmarkName, JointTrack>> = {};
  private readonly boneLengths = new Map<string, number>();
  private lastTimestamp: number | null = null;
  private lastReliableTimestamp: number | null = null;
  private options: PoseEngineV3Options;

  constructor(options: Partial<PoseEngineV3Options> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  setOptions(options: Partial<PoseEngineV3Options>): void {
    this.options = { ...this.options, ...options };
  }

  reset(): void {
    for (const name of JOINT_NAMES) delete this.tracks[name];
    this.boneLengths.clear();
    this.lastTimestamp = null;
    this.lastReliableTimestamp = null;
  }

  update(rawPose: PoseResult): PosePipelineFrame | null {
    if (this.lastTimestamp !== null && rawPose.timestamp <= this.lastTimestamp) return null;
    const startedAt = globalThis.performance?.now() ?? Date.now();
    const previousTimestamp = this.lastTimestamp;
    const deltaMs = clamp(
      rawPose.timestamp - (previousTimestamp ?? rawPose.timestamp - 67),
      8,
      250,
    );
    const detectorLandmarks: PoseLandmarks = {};
    const displayLandmarks: PoseLandmarks = {};
    const freshLandmarks: PoseLandmarkName[] = [];
    const predictedLandmarks: PoseLandmarkName[] = [];
    const rejectedLandmarks: PoseLandmarkName[] = [];

    for (const name of JOINT_NAMES) {
      const current = rawPose.landmarks[name];
      const track = this.tracks[name];
      const confident = current !== undefined && current.confidence >= this.options.confidenceFloor;
      const rejected =
        confident && track ? this.isIsolatedOutlier(name, current, rawPose.landmarks) : false;
      const reacquired =
        rejected && track && current ? this.isConfirmedReacquisition(track, current) : false;

      if (confident && (!rejected || reacquired)) {
        freshLandmarks.push(name);
        if (!track) {
          const initial = { ...current };
          this.tracks[name] = {
            detector: initial,
            display: initial,
            velocityX: 0,
            velocityY: 0,
            lastValidTimestamp: rawPose.timestamp,
            rejectedCount: 0,
          };
          detectorLandmarks[name] = { ...initial };
          displayLandmarks[name] = { ...initial };
          continue;
        }

        const seconds = deltaMs / 1000;
        const rawVelocityX = (current.x - track.detector.x) / seconds;
        const rawVelocityY = (current.y - track.detector.y) / seconds;
        const movement = Math.hypot(current.x - track.detector.x, current.y - track.detector.y);
        const motionFactor = clamp(movement / this.options.motionDistance, 0, 1);
        const confidenceFactor = clamp(
          (current.confidence - this.options.confidenceFloor) /
            Math.max(0.01, 1 - this.options.confidenceFloor),
          0.35,
          1,
        );
        const detectorAlpha =
          motionFactor >= 0.6 && current.confidence >= 0.5
            ? 1
            : clamp(
                (this.options.detectorStillAlpha +
                  (this.options.detectorMotionAlpha - this.options.detectorStillAlpha) *
                    motionFactor) *
                  confidenceFactor,
                0.55,
                1,
              );
        const displayAlpha = clamp(
          (this.options.displayStillAlpha +
            (this.options.displayMotionAlpha - this.options.displayStillAlpha) * motionFactor) *
            confidenceFactor,
          0.18,
          0.9,
        );
        track.detector = blend(track.detector, current, detectorAlpha);
        track.display = blend(track.display, current, displayAlpha);
        track.velocityX = track.velocityX * 0.45 + rawVelocityX * 0.55;
        track.velocityY = track.velocityY * 0.45 + rawVelocityY * 0.55;
        track.lastValidTimestamp = rawPose.timestamp;
        track.rejectedCandidate = undefined;
        track.rejectedCount = 0;
        detectorLandmarks[name] = { ...track.detector };
        displayLandmarks[name] = { ...track.display };
        continue;
      }

      if (rejected) rejectedLandmarks.push(name);
      if (track && rejected && current) {
        const closeToCandidate =
          track.rejectedCandidate !== undefined &&
          Math.hypot(current.x - track.rejectedCandidate.x, current.y - track.rejectedCandidate.y) <
            this.options.outlierDistance * 0.35;
        track.rejectedCount = closeToCandidate ? track.rejectedCount + 1 : 1;
        track.rejectedCandidate = { ...current };
      }
      if (!track) continue;
      const detectorPrediction = predict(
        track,
        rawPose.timestamp,
        this.options.detectorPredictionMs,
      );
      const displayPrediction = predict(track, rawPose.timestamp, this.options.displayPredictionMs);
      if (detectorPrediction) detectorLandmarks[name] = detectorPrediction;
      if (displayPrediction) {
        predictedLandmarks.push(name);
        const displayElapsed = Math.min(rawPose.timestamp - track.lastValidTimestamp, 120) / 1000;
        displayLandmarks[name] = {
          ...displayPrediction,
          x: clamp(track.display.x + track.velocityX * displayElapsed, 0, 1),
          y: clamp(track.display.y + track.velocityY * displayElapsed, 0, 1),
        };
      }
    }

    this.applySoftBoneConstraints(displayLandmarks);
    const leftFresh = LEFT_CORE.filter((name) => freshLandmarks.includes(name)).length;
    const rightFresh = RIGHT_CORE.filter((name) => freshLandmarks.includes(name)).length;
    const hasReliableCore = Math.max(leftFresh, rightFresh) === 4;
    if (hasReliableCore) this.lastReliableTimestamp = rawPose.timestamp;
    const withinGrace =
      this.lastReliableTimestamp !== null &&
      rawPose.timestamp - this.lastReliableTimestamp <= this.options.signalGraceMs;
    const bestFreshCore = Math.max(leftFresh, rightFresh);
    const signalQuality = hasReliableCore
      ? 'GOOD'
      : bestFreshCore >= 2 || withinGrace
        ? 'DEGRADED'
        : 'LOST';
    const trackingLatencyMs = (globalThis.performance?.now() ?? Date.now()) - startedAt;
    const tracking = {
      signalQuality,
      freshLandmarks,
      predictedLandmarks,
      rejectedLandmarks,
      lastReliableTimestamp: this.lastReliableTimestamp,
      trackingLatencyMs,
    } as const;
    const detectorPose = { ...copyPose(rawPose, detectorLandmarks), tracking };
    const displayPose = { ...copyPose(rawPose, displayLandmarks), tracking };
    this.lastTimestamp = rawPose.timestamp;
    return { rawPose, detectorPose, displayPose, trackingLatencyMs };
  }

  private isConfirmedReacquisition(track: JointTrack, current: PoseLandmark): boolean {
    return (
      current.confidence >= Math.max(0.65, this.options.confidenceFloor) &&
      track.rejectedCount >= 1 &&
      track.rejectedCandidate !== undefined &&
      Math.hypot(current.x - track.rejectedCandidate.x, current.y - track.rejectedCandidate.y) <
        this.options.outlierDistance * 0.35
    );
  }

  private isIsolatedOutlier(
    name: PoseLandmarkName,
    current: PoseLandmark,
    currentLandmarks: PoseLandmarks,
  ): boolean {
    const track = this.tracks[name];
    if (!track) return false;
    const movement = Math.hypot(current.x - track.detector.x, current.y - track.detector.y);
    if (movement <= this.options.outlierDistance) return false;
    const neighborMovements = (NEIGHBORS[name] ?? [])
      .map((neighborName) => {
        const neighbor = currentLandmarks[neighborName];
        const neighborTrack = this.tracks[neighborName];
        return neighbor && neighborTrack
          ? Math.hypot(neighbor.x - neighborTrack.detector.x, neighbor.y - neighborTrack.detector.y)
          : null;
      })
      .filter((value): value is number => value !== null);
    const surroundingMotion = neighborMovements.length ? Math.max(...neighborMovements) : 0;
    return surroundingMotion < movement * 0.4;
  }

  private applySoftBoneConstraints(landmarks: PoseLandmarks): void {
    for (const [startName, endName] of BONES) {
      const start = landmarks[startName];
      const end = landmarks[endName];
      if (!start || !end) continue;
      const key = `${startName}:${endName}`;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (!Number.isFinite(length) || length <= 0.001) continue;
      const expected = this.boneLengths.get(key);
      if (expected === undefined) {
        this.boneLengths.set(key, length);
        continue;
      }
      if (length >= expected * 0.72 && length <= expected * 1.38) {
        this.boneLengths.set(key, expected * 0.96 + length * 0.04);
        continue;
      }
      const targetLength = clamp(length, expected * 0.72, expected * 1.38);
      const correction = (targetLength - length) * 0.35;
      end.x += ((end.x - start.x) / length) * correction;
      end.y += ((end.y - start.y) / length) * correction;
    }
  }
}
