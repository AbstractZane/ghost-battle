import { PushupDetector } from '@/exercises/pushup/PushupDetector';
import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';
import type { PoseQualityResult } from '@/pose/poseQuality';
import { PoseEngineV3 } from '@/pose/poseEngineV3';
import { DEFAULT_POSE_MODEL, MOVENET_LIGHTNING, type RuntimePoseModelId } from '@/pose/poseModels';
import type { PosePipelineFrame, PoseResult } from '@/pose/poseTypes';

export interface PoseTraceFrame {
  rawPose: PoseResult;
  detectorPose: PoseResult;
  displayPose: PoseResult;
  detector: {
    signalQuality: ExerciseDetectionResult['metrics']['signalQuality'];
    context: ExerciseDetectionResult['metrics']['contextState'];
    armed: ExerciseDetectionResult['metrics']['armState'];
    repState: ExerciseDetectionResult['state'];
    elbowAngle: number | null;
    bodyAngle: number | null;
    elbowVelocity: number | null;
    repCompleted: boolean;
    totalReps: number;
    feedback: string;
    selectedSide?: ExerciseDetectionResult['metrics']['selectedSide'];
    elbowSource?: ExerciseDetectionResult['metrics']['elbowSource'];
    motionPhase?: ExerciseDetectionResult['metrics']['motionPhase'];
    recentPeakAngle?: number | null;
    recentPeakTimestamp?: number | null;
    variant?: ExerciseDetectionResult['metrics']['exerciseVariant'];
    variantFrameEvidence?: ExerciseDetectionResult['metrics']['variantFrameEvidence'];
    candidateActive?: boolean;
    candidateEligibility?: ExerciseDetectionResult['metrics']['candidateEligibility'];
    requestedTransition?: ExerciseDetectionResult['metrics']['requestedTransition'] | null;
    transitionAccepted?: boolean;
    rejectionReason?: ExerciseDetectionResult['rejectedReason'] | null;
    gate?: string;
    readinessState?: PoseQualityResult['state'];
    readinessFailureReason?: string | null;
  };
}

export interface PoseTrace {
  schemaVersion: 4;
  createdAt: string;
  poseModel: RuntimePoseModelId;
  runtime?: PoseTraceRuntimeMetadata;
  frames: PoseTraceFrame[];
}

export interface PoseTraceRuntimeMetadata {
  platform: 'web' | 'native';
  detectorVersion?: 'v4' | 'v5' | 'v6';
  browser?: string;
  cameraFacing?: 'front' | 'back';
  requestedInferenceFps?: number;
  actualInferenceFps?: number;
  inferenceLatencyMs?: number;
}

export class PoseTraceRecorder {
  private recording = false;
  private frames: PoseTraceFrame[] = [];
  private createdAt = '';
  private poseModel: RuntimePoseModelId = DEFAULT_POSE_MODEL;
  private runtime: PoseTraceRuntimeMetadata | undefined;

  start(
    now = new Date(),
    poseModel: RuntimePoseModelId = DEFAULT_POSE_MODEL,
    runtime?: PoseTraceRuntimeMetadata,
  ): void {
    this.recording = true;
    this.frames = [];
    this.createdAt = now.toISOString();
    this.poseModel = poseModel;
    this.runtime = runtime;
  }

  record(
    frame: PosePipelineFrame,
    result: ExerciseDetectionResult,
    gate?: string,
    readiness?: PoseQualityResult,
  ): void {
    if (!this.recording) return;
    this.frames.push({
      rawPose: frame.rawPose,
      detectorPose: frame.detectorPose,
      displayPose: frame.displayPose,
      detector: {
        signalQuality: result.metrics.signalQuality,
        context: result.metrics.contextState,
        armed: result.metrics.armState,
        repState: result.state,
        elbowAngle: result.metrics.elbowAngle ?? null,
        bodyAngle: result.metrics.bodyAngle ?? null,
        elbowVelocity: result.metrics.elbowVelocity ?? null,
        repCompleted: result.repCompleted,
        totalReps: result.totalReps,
        feedback: result.feedback,
        selectedSide: result.metrics.selectedSide,
        elbowSource: result.metrics.elbowSource,
        motionPhase: result.metrics.motionPhase,
        recentPeakAngle: result.metrics.recentPeakAngle ?? null,
        recentPeakTimestamp: result.metrics.recentPeakTimestamp ?? null,
        variant: result.metrics.exerciseVariant,
        variantFrameEvidence: result.metrics.variantFrameEvidence,
        candidateActive: result.metrics.candidateActive,
        candidateEligibility: result.metrics.candidateEligibility,
        requestedTransition: result.metrics.requestedTransition ?? null,
        transitionAccepted: result.metrics.transitionAccepted,
        rejectionReason: result.rejectedReason ?? null,
        gate,
        readinessState: readiness?.state,
        readinessFailureReason: readiness?.failureReason,
      },
    });
  }

  stop(): PoseTrace {
    this.recording = false;
    return this.snapshot();
  }

  snapshot(): PoseTrace {
    return {
      schemaVersion: 4,
      createdAt: this.createdAt,
      poseModel: this.poseModel,
      ...(this.runtime ? { runtime: this.runtime } : {}),
      frames: [...this.frames],
    };
  }

  isRecording(): boolean {
    return this.recording;
  }

  frameCount(): number {
    return this.frames.length;
  }
}

export function serializePoseTrace(trace: PoseTrace): string {
  return JSON.stringify(trace);
}

export function parsePoseTrace(value: string): PoseTrace {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object') throw new Error('Trace must be a JSON object.');
  const trace = parsed as {
    schemaVersion?: number;
    createdAt?: string;
    poseModel?: unknown;
    frames?: Array<PoseTraceFrame | { pose: PoseResult; detector: PoseTraceFrame['detector'] }>;
  };
  if (!Array.isArray(trace.frames)) {
    throw new Error('Unsupported pose trace format.');
  }
  if (trace.schemaVersion === 4 && isPoseModelId(trace.poseModel)) return trace as PoseTrace;
  if (trace.schemaVersion === 2 || trace.schemaVersion === 3) {
    const frames = trace.frames as PoseTraceFrame[];
    return {
      schemaVersion: 4,
      createdAt: trace.createdAt ?? '',
      poseModel: frames[0]?.rawPose.poseModel ?? MOVENET_LIGHTNING,
      frames,
    };
  }
  if (trace.schemaVersion === 1) {
    return {
      schemaVersion: 4,
      createdAt: trace.createdAt ?? '',
      poseModel: MOVENET_LIGHTNING,
      frames: trace.frames.map((frame) => {
        if (!('pose' in frame)) throw new Error('Unsupported pose trace format.');
        return {
          rawPose: frame.pose,
          detectorPose: frame.pose,
          displayPose: frame.pose,
          detector: frame.detector,
        };
      }),
    };
  }
  throw new Error('Unsupported pose trace format.');
}

function isPoseModelId(value: unknown): value is RuntimePoseModelId {
  return value === 'movenet-lightning' || value === 'movenet-thunder' || value === 'blazepose-full';
}

export function replayPoseTrace(trace: PoseTrace, detector = new PushupDetector()) {
  return trace.frames.map((frame) =>
    detector.processPose(frame.detectorPose, frame.detectorPose.timestamp),
  );
}

/** Re-runs the temporal tracker from canonical raw landmarks; no recorded video is required. */
export function replayPosePipeline(
  trace: PoseTrace,
  engine = new PoseEngineV3(),
): PosePipelineFrame[] {
  const replayed: PosePipelineFrame[] = [];
  for (const frame of trace.frames) {
    const pipelineFrame = engine.update(frame.rawPose);
    if (pipelineFrame) replayed.push(pipelineFrame);
  }
  return replayed;
}

export interface PoseTraceReplaySummary {
  expectedReps: number;
  detectedReps: number;
  rejectedCandidates: Partial<
    Record<NonNullable<ExerciseDetectionResult['rejectedReason']>, number>
  >;
}

/** Replays the full raw-pose tracker boundary and summarizes deterministic V4 outcomes. */
export function summarizePoseTraceReplay(trace: PoseTrace): PoseTraceReplaySummary {
  const engine = new PoseEngineV3();
  const detector = new PushupDetector();
  const rejectedCandidates: PoseTraceReplaySummary['rejectedCandidates'] = {};
  let detectedReps = 0;
  for (const frame of trace.frames) {
    const pipelineFrame = engine.update(frame.rawPose);
    if (!pipelineFrame) continue;
    const result = detector.processPose(pipelineFrame.detectorPose);
    if (result.repCompleted) detectedReps += 1;
    if (result.rejectedReason) {
      rejectedCandidates[result.rejectedReason] =
        (rejectedCandidates[result.rejectedReason] ?? 0) + 1;
    }
  }
  return {
    expectedReps: Math.max(0, ...trace.frames.map((frame) => frame.detector.totalReps)),
    detectedReps,
    rejectedCandidates,
  };
}
