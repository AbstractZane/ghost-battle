import type { PoseLandmarkName, PosePipelineFrame, PoseResult } from './poseTypes';

const MEASURED_JOINTS: ReadonlyArray<PoseLandmarkName> = [
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

export interface PoseMotionSummary {
  meanJointDisplacement: number;
  p95JointDisplacement: number;
  samples: number;
  byLandmark: Partial<
    Record<
      PoseLandmarkName,
      { meanJointDisplacement: number; p95JointDisplacement: number; samples: number }
    >
  >;
}

export interface PoseJitterResult {
  durationMs: number;
  raw: PoseMotionSummary;
  detector: PoseMotionSummary;
  display: PoseMotionSummary;
}

function percentile(values: ReadonlyArray<number>, fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

export function summarizePoseMotion(poses: ReadonlyArray<PoseResult>): PoseMotionSummary {
  const displacements: number[] = [];
  const displacementByLandmark: Partial<Record<PoseLandmarkName, number[]>> = {};
  for (let index = 1; index < poses.length; index += 1) {
    const previous = poses[index - 1];
    const current = poses[index];
    if (!previous || !current || current.timestamp <= previous.timestamp) continue;
    for (const name of MEASURED_JOINTS) {
      const before = previous.landmarks[name];
      const after = current.landmarks[name];
      if (!before || !after || before.confidence < 0.12 || after.confidence < 0.12) continue;
      const displacement = Math.hypot(after.x - before.x, after.y - before.y);
      displacements.push(displacement);
      (displacementByLandmark[name] ??= []).push(displacement);
    }
  }
  const byLandmark: PoseMotionSummary['byLandmark'] = {};
  for (const name of MEASURED_JOINTS) {
    const values = displacementByLandmark[name];
    if (!values?.length) continue;
    byLandmark[name] = {
      meanJointDisplacement:
        values.reduce((total, value) => total + value, 0) / Math.max(1, values.length),
      p95JointDisplacement: percentile(values, 0.95),
      samples: values.length,
    };
  }
  return {
    meanJointDisplacement:
      displacements.reduce((total, value) => total + value, 0) / Math.max(1, displacements.length),
    p95JointDisplacement: percentile(displacements, 0.95),
    samples: displacements.length,
    byLandmark,
  };
}

export function noisiestLandmark(summary: PoseMotionSummary): {
  name: PoseLandmarkName;
  p95JointDisplacement: number;
} | null {
  let noisiest: { name: PoseLandmarkName; p95JointDisplacement: number } | null = null;
  for (const name of MEASURED_JOINTS) {
    const p95JointDisplacement = summary.byLandmark[name]?.p95JointDisplacement;
    if (p95JointDisplacement === undefined) continue;
    if (!noisiest || p95JointDisplacement > noisiest.p95JointDisplacement) {
      noisiest = { name, p95JointDisplacement };
    }
  }
  return noisiest;
}

export class PoseJitterBenchmark {
  private readonly frames: PosePipelineFrame[] = [];

  constructor(
    private readonly startedAt: number,
    private readonly durationMs = 10_000,
  ) {}

  add(frame: PosePipelineFrame): PoseJitterResult | null {
    if (frame.rawPose.timestamp < this.startedAt) return null;
    this.frames.push(frame);
    if (frame.rawPose.timestamp - this.startedAt < this.durationMs) return null;
    return this.result();
  }

  result(): PoseJitterResult {
    return {
      durationMs: this.durationMs,
      raw: summarizePoseMotion(this.frames.map((frame) => frame.rawPose)),
      detector: summarizePoseMotion(this.frames.map((frame) => frame.detectorPose)),
      display: summarizePoseMotion(this.frames.map((frame) => frame.displayPose)),
    };
  }
}
