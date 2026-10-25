import type { RuntimePoseModelId } from './poseModels';

export type PoseSide = 'left' | 'right';

export type PoseLandmarkName =
  | 'nose'
  | 'leftEye'
  | 'rightEye'
  | 'leftEar'
  | 'rightEar'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle';

export interface PoseLandmark {
  x: number;
  y: number;
  z?: number;
  confidence: number;
}

export type PoseLandmarks = Partial<Record<PoseLandmarkName, PoseLandmark>>;

export interface PoseTrackingMetadata {
  signalQuality: 'GOOD' | 'DEGRADED' | 'LOST';
  freshLandmarks: PoseLandmarkName[];
  predictedLandmarks?: PoseLandmarkName[];
  rejectedLandmarks?: PoseLandmarkName[];
  lastReliableTimestamp: number | null;
  trackingLatencyMs?: number;
}

export interface PoseResult {
  timestamp: number;
  /** Canonical, anatomically labelled coordinates consumed by exercise logic. */
  landmarks: PoseLandmarks;
  /** Coordinates emitted from the model before canonical input-mirror correction. */
  rawLandmarks: PoseLandmarks;
  inferenceLatencyMs: number;
  sourceWidth: number;
  sourceHeight: number;
  cameraFacing: 'front' | 'back';
  orientation: 'up' | 'down' | 'left' | 'right';
  inputMirrored: boolean;
  /** Applied only when projecting canonical coordinates over the camera preview. */
  displayMirrored: boolean;
  /** Interchangeable model source; downstream geometry remains canonical. */
  poseModel?: RuntimePoseModelId;
  tracking?: PoseTrackingMetadata;
}

export interface CameraFrame {
  width: number;
  height: number;
  timestamp: number;
  pixelBuffer: ArrayBuffer;
}

export interface PoseDiagnostics {
  inferenceAttempts?: number;
  emptyResults?: number;
  inferenceErrors?: number;
  pendingInferenceMs?: number;
  visibility?: string;
  videoPaused?: boolean;
  trackState?: string;
  cameraFps: number;
  inferenceFps: number;
  fps: number;
  inferenceLatencyMs: number;
  poseAgeMs: number;
  droppedFrames: number;
  modelState: 'loading' | 'ready' | 'error';
  poseModel?: RuntimePoseModelId;
  cameraWidth?: number;
  cameraHeight?: number;
}

export interface PosePipelineFrame {
  /** Unfiltered canonical model output. */
  rawPose: PoseResult;
  /** Low-latency, outlier-protected pose consumed by exercise detectors. */
  detectorPose: PoseResult;
  /** More strongly stabilized pose consumed only by the skeleton overlay. */
  displayPose: PoseResult;
  trackingLatencyMs: number;
}
