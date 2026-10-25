import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import * as tf from '@tensorflow/tfjs-core';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { mapWebMoveNetPose } from '@/pose/webPoseMapping';

/** Editor-only estimator. CPU fallback supports browsers without a graphics context. */
export async function createGhostVideoEstimator() {
  let gpu = false;
  try {
    gpu = await tf.setBackend('webgl');
  } catch {
    /* Try the existing CPU backend. */
  }
  if (!gpu && !(await tf.setBackend('cpu'))) throw new Error('No supported inference backend.');
  await tf.ready();
  const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    enableSmoothing: false,
    minPoseScore: 0.01,
  });
  return {
    backend: gpu ? 'webgl' : 'cpu',
    async estimate(video: HTMLVideoElement, timestamp: number) {
      const start = performance.now();
      const poses = await detector.estimatePoses(video, { flipHorizontal: false }, timestamp);
      return mapWebMoveNetPose({
        keypoints: poses[0]?.keypoints,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        timestamp,
        inferenceLatencyMs: performance.now() - start,
        cameraFacing: 'back',
      });
    },
    dispose() {
      detector.dispose();
    },
  };
}
