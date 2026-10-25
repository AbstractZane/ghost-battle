import type { PoseDiagnostics, PoseResult } from '@/pose/poseTypes';
import type { PoseQualityResult } from '@/pose/poseQuality';
import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';
import type { PushupDiagnosticsV5 } from '@/exercises/pushup/v5/v5Types';
import { detectorGate } from './detectorGate';

/** Explicit local diagnostic sessions. No images or landmark coordinates are retained. */
export class DetectorDiagnosticSession {
  private frames = 0;
  private previousTimestamp: number | null = null;
  private lastLogAt = -Infinity;
  private previousState = '';
  private transitions = 0;
  private reps = 0;
  private readyFrames = 0;
  private invalidDeltas = 0;
  private maxDeltaMs = 0;
  private blockers: Record<string, number> = {};
  private gates: Record<string, number> = {};
  private contextStates: Record<string, number> = {};
  private armStates: Record<string, number> = {};
  private motionPhases: Record<string, number> = {};
  private candidateEligibility: Record<string, number> = {};
  private variants: Record<string, number> = {};
  private variantEvidence: Record<string, number> = {};
  private received = 0;
  private discarded = 0;
  private healthSamples = 0;
  private healthTotals = { attempts: 0, empty: 0, errors: 0, noCamera: 0, pending: 0 };
  private paused = false;
  private trackingResets: Record<string, number> = {};
  trackingReset(reason: string, now: number) {
    this.trackingResets[reason] = (this.trackingResets[reason] ?? 0) + 1;
    this.log('tracking-reset', { reason, elapsedMs: now - this.startedAt });
  }
  receive() {
    this.received++;
  }
  discard() {
    this.discarded++;
  }
  lifecycle(paused: boolean) {
    this.paused = paused;
    this.log('lifecycle', { paused });
  }
  camera(health: PoseDiagnostics) {
    this.healthSamples++;
    this.healthTotals.attempts += health.inferenceAttempts ?? 0;
    this.healthTotals.empty += health.emptyResults ?? 0;
    this.healthTotals.errors += health.inferenceErrors ?? 0;
    if (health.cameraFps === 0) this.healthTotals.noCamera++;
    if ((health.pendingInferenceMs ?? 0) > 3000) this.healthTotals.pending++;
    this.log('camera', health);
  }
  constructor(
    private readonly version: string,
    private readonly startedAt: number,
    private readonly emit: (line: string) => void = (line) => console.info(line),
  ) {
    this.log('start', { detector: version });
  }
  private log(event: string, data: object) {
    this.emit('[DetectorLab] ' + JSON.stringify({ session: this.startedAt, event, ...data }));
  }
  add(
    raw: PoseResult,
    detector: PoseResult,
    result: ExerciseDetectionResult,
    readiness: PoseQualityResult,
    v5: PushupDiagnosticsV5 | null,
    now: number,
  ) {
    const delta = this.previousTimestamp === null ? null : raw.timestamp - this.previousTimestamp;
    this.previousTimestamp = raw.timestamp;
    this.frames++;
    if (delta !== null) {
      if (delta <= 0 || !Number.isFinite(delta)) this.invalidDeltas++;
      else this.maxDeltaMs = Math.max(this.maxDeltaMs, delta);
    }
    if (result.repCompleted) this.reps++;
    if (readiness.state === 'READY') this.readyFrames++;
    // Numeric confidence fluctuations are samples, not distinct failure categories.
    const blocker = (readiness.failureReason ?? 'NONE').replace(/ [\d.]+ < [\d.]+/g, '');
    this.blockers[blocker] = (this.blockers[blocker] ?? 0) + 1;
    const gate = detectorGate(this.version, result, readiness);
    const gateCategory = gate.split(':')[0] ?? gate;
    this.gates[gateCategory] = (this.gates[gateCategory] ?? 0) + 1;
    const { metrics } = result;
    this.contextStates[metrics.contextState] = (this.contextStates[metrics.contextState] ?? 0) + 1;
    this.armStates[metrics.armState] = (this.armStates[metrics.armState] ?? 0) + 1;
    this.motionPhases[metrics.motionPhase] = (this.motionPhases[metrics.motionPhase] ?? 0) + 1;
    this.candidateEligibility[metrics.candidateEligibility] =
      (this.candidateEligibility[metrics.candidateEligibility] ?? 0) + 1;
    this.variants[metrics.exerciseVariant] = (this.variants[metrics.exerciseVariant] ?? 0) + 1;
    this.variantEvidence[metrics.variantFrameEvidence] =
      (this.variantEvidence[metrics.variantFrameEvidence] ?? 0) + 1;
    const state = JSON.stringify([
      readiness.state,
      result.state,
      blocker,
      gateCategory,
      result.metrics.selectedSide,
      v5?.rejectionReason ?? result.metrics.lastRejectionReason,
    ]);
    const changed = state !== this.previousState;
    if (changed) this.transitions++;
    this.previousState = state;
    // Bounded output: first 60 state changes, then one sample/second. Reps always emit.
    if (!result.repCompleted && !(changed && this.transitions <= 60) && now - this.lastLogAt < 1000)
      return;
    this.lastLogAt = now;
    const confidence = (pose: PoseResult) =>
      Object.fromEntries(
        Object.entries(pose.landmarks)
          .filter(([name]) => /Shoulder|Elbow|Wrist|Hip|Knee|Ankle/.test(name))
          .map(([name, point]) => [name, point ? Number(point.confidence.toFixed(3)) : null]),
      );
    this.log(result.repCompleted ? 'rep' : changed ? 'transition' : 'sample', {
      elapsedMs: now - this.startedAt,
      timestamp: raw.timestamp,
      deltaMs: delta,
      ageMs: now - raw.timestamp,
      inferenceMs: raw.inferenceLatencyMs,
      model: raw.poseModel,
      resolution: [raw.sourceWidth, raw.sourceHeight],
      facing: raw.cameraFacing,
      detector: this.version,
      rawConfidence: confidence(raw),
      detectorConfidence: confidence(detector),
      tracking: detector.tracking,
      readiness: readiness.state,
      blocker,
      gate,
      thresholds: readiness.thresholds,
      geometry: readiness.geometry,
      phase: result.state,
      motionPhase: metrics.motionPhase,
      context: metrics.contextState,
      arm: metrics.armState,
      side: metrics.selectedSide,
      sideSelection: metrics.sideSelectionReason,
      elbow: metrics.elbowAngle,
      velocity: metrics.elbowVelocity,
      armSignalReliable: metrics.armSignalReliable,
      bodyAngle: metrics.bodyAngle,
      torsoAngleFromHorizontal: metrics.torsoAngleFromHorizontal,
      wristHeightToHipRatio: metrics.wristHeightToHipRatio,
      postureEvidence: metrics.postureEvidence,
      postureEvidenceMs: metrics.postureEvidenceMs,
      bodySpan: metrics.bodySpan,
      bodyAlignmentSource: metrics.bodyAlignmentSource,
      exerciseVariant: metrics.exerciseVariant,
      variantEvidence: metrics.variantFrameEvidence,
      variantSide: metrics.variantSide,
      variantConfidence: metrics.variantConfidence,
      kneeAngle: metrics.kneeAngle,
      legChainAngle: metrics.legChainAngle,
      ankleExtensionRatio: metrics.ankleExtensionRatio,
      ankleDeviationRatio: metrics.ankleDeviationRatio,
      candidate: metrics.candidateActive,
      candidateEligibility: metrics.candidateEligibility,
      transitionAccepted: metrics.transitionAccepted,
      rejection: result.rejectedReason ?? v5?.rejectionReason,
      lastRejection: metrics.lastRejectionReason,
      stability: v5?.stability,
      temporal: v5?.temporal,
    });
  }
  finish(now: number, reason = 'completed') {
    const summary = {
      detector: this.version,
      reason,
      durationMs: now - this.startedAt,
      frames: this.frames,
      reps: this.reps,
      readyFrames: this.readyFrames,
      invalidTimestampDeltas: this.invalidDeltas,
      maxFrameDeltaMs: this.maxDeltaMs,
      trackingResets: this.trackingResets,
      blockers: this.blockers,
      gates: this.gates,
      contextStates: this.contextStates,
      armStates: this.armStates,
      motionPhases: this.motionPhases,
      candidateEligibility: this.candidateEligibility,
      variants: this.variants,
      variantEvidence: this.variantEvidence,
      receivedPoses: this.received,
      discardedByPoseEngine: this.discarded,
      cameraHealthSamples: this.healthSamples,
      cameraTotals: this.healthTotals,
      findings: [
        ...(this.paused ? ['SESSION_PAUSED'] : []),
        ...(this.healthTotals.noCamera ? ['CAMERA_CALLBACK_GAPS'] : []),
        ...(this.healthTotals.pending ? ['INFERENCE_PENDING_OVER_3_SECONDS'] : []),
        ...(this.healthTotals.empty ? ['MODEL_RETURNED_NO_POSE'] : []),
        ...(this.healthTotals.errors ? ['INFERENCE_OR_POSE_CALLBACK_ERRORS'] : []),
        ...(this.discarded ? ['POSE_ENGINE_DISCARDED_TIMESTAMPS'] : []),
        ...(!this.healthSamples ? ['CAMERA_HEALTH_UNAVAILABLE'] : []),
        ...(this.frames > 0 && !this.readyFrames ? ['READINESS_NEVER_REACHED'] : []),
        ...(this.frames > 0 && !this.contextStates.PUSHUP ? ['CONTEXT_NEVER_REACHED_PUSHUP'] : []),
        ...(this.contextStates.PUSHUP && !this.armStates.ARMED ? ['ARMING_NEVER_REACHED'] : []),
        ...(this.armStates.ARMED && !this.motionPhases.DOWN ? ['BOTTOM_NEVER_REACHED'] : []),
      ],
    };
    this.log('summary', summary);
    return summary;
  }
}
