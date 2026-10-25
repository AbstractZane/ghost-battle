import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-core';

import { mapWebMoveNetPose } from './webPoseMapping';
import type { PoseResult } from './poseTypes';

export class WebMoveNetPoseEstimator {
  private constructor(private readonly detector: poseDetection.PoseDetector) {}

  static async create(): Promise<WebMoveNetPoseEstimator> {
    await tf.setBackend('webgl');
    await tf.ready();
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: false,
      // Native TFLite always forwards its 17 confidence values. Keep the TFJS
      // aggregate gate out of the way so Pose Engine V3 owns signal quality.
      minPoseScore: 0.01,
    });
    return new WebMoveNetPoseEstimator(detector);
  }

  async estimate(
    video: HTMLVideoElement,
    cameraFacing: 'front' | 'back',
    timestamp: number,
  ): Promise<PoseResult | null> {
    const startedAt = performance.now();
    // Keep MoveNet's crop region between consecutive camera frames. Calling reset()
    // here clears that temporal state, forcing every inference to start from the full
    // image and making small or partially occluded bodies materially less stable.
    // The detector resets itself when it cannot find a pose. Camera-source changes
    // explicitly call reset(), once, through the lifecycle method below.
    const poses = await this.detector.estimatePoses(video, { flipHorizontal: false }, timestamp);
    return mapWebMoveNetPose({
      keypoints: poses[0]?.keypoints,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      timestamp,
      inferenceLatencyMs: performance.now() - startedAt,
      cameraFacing,
    });
  }

  /** Reset temporal crop/filter state when a different camera stream starts. */
  resetForCameraSourceChange(): void {
    this.detector.reset();
  }

  dispose(): void {
    this.detector.dispose();
  }
}
