import type { PoseModelId } from './poseModels';

export const TARGET_POSE_INFERENCE_FPS = 15;
export const POSE_INFERENCE_INTERVAL_MS = 1000 / TARGET_POSE_INFERENCE_FPS;
export const DROP_INFERENCE_FRAMES_WHILE_BUSY = true;
export const DEVELOPMENT_LIGHTNING_TARGET_FPS = 30;

export function poseInferenceTargetFps(
  model: PoseModelId,
  options: { experimentalLightning?: boolean; development?: boolean } = {},
): number {
  if (
    model === 'movenet-lightning' &&
    options.experimentalLightning === true &&
    options.development === true
  ) {
    return DEVELOPMENT_LIGHTNING_TARGET_FPS;
  }
  return TARGET_POSE_INFERENCE_FPS;
}

export function poseInferenceIntervalMs(targetFps: number): number {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new Error('Pose inference target FPS must be greater than zero.');
  }
  return 1000 / targetFps;
}

export function shouldSchedulePoseInference(
  lastInferenceAt: number,
  now: number,
  intervalMs = POSE_INFERENCE_INTERVAL_MS,
): boolean {
  'worklet';
  return now - lastInferenceAt >= intervalMs;
}
