import { analyzePushupForm } from '@/exercises/pushup/PushupFormAnalyzer';
import { calculateAngle } from '@/pose/poseMath';
import { landmarksForSide } from '@/pose/sideSelector';
import type { PoseResult } from '@/pose/poseTypes';
import type { ExerciseRep } from '@/types/models';

import { HybridMlV1Local, type HybridMlV1Diagnostics } from './hybridMlV1Local';
import { MlV1LocalValidator } from './mlV1Local';

/** Loaded only by the explicitly local Solo Practice path. Never writes results. */
export class SoloHybridLocal {
  private readonly validator = new MlV1LocalValidator();
  private readonly hybrid: HybridMlV1Local;
  private active = true;
  private inFlight = new Set<Promise<unknown>>();
  private index = 0;
  private lastEvent = '';

  constructor(onRep: (rep: ExerciseRep) => void) {
    this.hybrid = new HybridMlV1Local(
      this.validator,
      (candidate, poses) => {
        if (!this.active) return;
        const names = landmarksForSide(candidate.arm);
        const angles = poses.flatMap((pose) => {
          const angle = calculateAngle(
            pose.landmarks[names.shoulder],
            pose.landmarks[names.hip],
            pose.landmarks[names.ankle],
          );
          return angle === null ? [] : [angle];
        });
        const averageBodyAngle = angles.length
          ? angles.reduce((sum, angle) => sum + angle, 0) / angles.length
          : 0;
        const averageConfidence = poses.length
          ? poses.reduce((sum, pose) => sum + (pose.landmarks[names.elbow]?.confidence ?? 0), 0) /
            poses.length
          : 0;
        const form = analyzePushupForm({ ...candidate, averageBodyAngle, averageConfidence });
        onRep({
          index: ++this.index,
          timestamp: candidate.completedAt,
          durationMs: candidate.durationMs,
          minimumElbowAngle: candidate.minimumElbowAngle,
          maximumElbowAngle: candidate.maximumElbowAngle,
          averageBodyAngle,
          qualityScore: form.qualityScore,
          grade: form.grade,
        });
      },
      (diagnostics) => {
        const event = JSON.stringify([
          diagnostics.candidateState,
          diagnostics.candidateArm,
          diagnostics.trackingHeld,
          diagnostics.rejectionReason,
          diagnostics.mlDecision,
          diagnostics.finalRepCount,
        ]);
        if (event !== this.lastEvent) {
          this.lastEvent = event;
          console.info('[SoloHybrid]', JSON.stringify(diagnostics));
        }
      },
    );
  }

  getDiagnostics(): HybridMlV1Diagnostics {
    return this.hybrid.getDiagnostics();
  }

  async load(serialized: string): Promise<void> {
    await this.validator.load(serialized);
    console.info('[SoloHybrid] model ready: ML V1, Lightning, frozen threshold');
  }

  addPose(pose: PoseResult): Promise<unknown> {
    if (!this.active) return Promise.resolve();
    const work = this.hybrid.addPose(pose);
    this.inFlight.add(work);
    return work.finally(() => this.inFlight.delete(work));
  }

  reset(clearCount = false): void {
    this.hybrid.reset();
    this.lastEvent = '';
    if (clearCount) this.index = 0;
  }

  async dispose(): Promise<void> {
    this.active = false;
    this.hybrid.reset();
    await Promise.allSettled([...this.inFlight]);
    this.validator.dispose();
  }
}
