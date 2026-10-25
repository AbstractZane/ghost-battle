import { noisiestLandmark, summarizePoseMotion } from './poseMetrics';
import type { CameraFacing } from './cameraDisplay';
import type { RuntimePoseModelId } from './poseModels';
import type { PoseLandmarkName, PoseResult } from './poseTypes';

export interface PoseModelBenchmarkResult {
  poseModel: RuntimePoseModelId;
  cameraFacing: CameraFacing;
  durationMs: number;
  framesAnalyzed: number;
  meanInferenceMs: number;
  p95InferenceMs: number;
  meanPoseFps: number;
  meanPoseAgeMs: number;
  stationaryJointJitter: number;
  worstJoint: { name: PoseLandmarkName; p95Jitter: number } | null;
  confidence: {
    mean: number;
    p10: number;
    minimum: number;
    samples: number;
  };
}

export class PoseModelBenchmark {
  private readonly poses: PoseResult[] = [];
  private readonly observedAt: number[] = [];

  constructor(
    private readonly poseModel: RuntimePoseModelId,
    private readonly cameraFacing: CameraFacing,
    private readonly startedAt: number,
    private readonly durationMs = 15_000,
  ) {}

  add(pose: PoseResult, receivedAt: number): PoseModelBenchmarkResult | null {
    if (receivedAt < this.startedAt) return null;
    if (pose.poseModel !== this.poseModel || pose.cameraFacing !== this.cameraFacing) return null;
    this.poses.push(pose);
    this.observedAt.push(receivedAt);
    if (receivedAt - this.startedAt < this.durationMs) return null;
    return this.result();
  }

  result(): PoseModelBenchmarkResult {
    const inference = this.poses.map((pose) => pose.inferenceLatencyMs);
    const ages = this.poses.map((pose, index) =>
      Math.max(0, (this.observedAt[index] ?? pose.timestamp) - pose.timestamp),
    );
    const confidences = this.poses.flatMap((pose) =>
      Object.values(pose.landmarks)
        .map((landmark) => landmark?.confidence)
        .filter((value): value is number => value !== undefined && Number.isFinite(value)),
    );
    const motion = summarizePoseMotion(this.poses);
    const worst = noisiestLandmark(motion);
    const firstTimestamp = this.poses[0]?.timestamp ?? this.startedAt;
    const lastTimestamp = this.poses.at(-1)?.timestamp ?? firstTimestamp;
    const poseDuration = Math.max(1, lastTimestamp - firstTimestamp);
    return {
      poseModel: this.poseModel,
      cameraFacing: this.cameraFacing,
      durationMs: this.durationMs,
      framesAnalyzed: this.poses.length,
      meanInferenceMs: mean(inference),
      p95InferenceMs: percentile(inference, 0.95),
      meanPoseFps: Math.max(0, ((this.poses.length - 1) * 1000) / poseDuration),
      meanPoseAgeMs: mean(ages),
      stationaryJointJitter: motion.meanJointDisplacement,
      worstJoint: worst ? { name: worst.name, p95Jitter: worst.p95JointDisplacement } : null,
      confidence: {
        mean: mean(confidences),
        p10: percentile(confidences, 0.1),
        minimum: confidences.length ? Math.min(...confidences) : 0,
        samples: confidences.length,
      },
    };
  }
}

function mean(values: ReadonlyArray<number>): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function percentile(values: ReadonlyArray<number>, fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const nearestRank = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.min(sorted.length - 1, nearestRank)] ?? 0;
}
