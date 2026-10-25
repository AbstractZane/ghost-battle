import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';
import * as tf from '@tensorflow/tfjs-core';

import { mapWebBlazePose } from './webPoseMapping';
import type { PoseResult } from './poseTypes';

/** Browser-only BlazePose Full adapter. It exposes only canonical PoseResult,
 * keeping every detector independent of TensorFlow and model-specific output. */
export class WebBlazePoseEstimator {
  private constructor(private readonly detector: poseDetection.PoseDetector) {}

  static async create(): Promise<WebBlazePoseEstimator> {
    await tf.setBackend('webgl');
    await tf.ready();
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, {
      runtime: 'tfjs',
      modelType: 'full',
      enableSmoothing: true,
      enableSegmentation: false,
    });
    return new WebBlazePoseEstimator(detector);
  }

  async estimate(
    video: HTMLVideoElement,
    cameraFacing: 'front' | 'back',
    timestamp: number,
  ): Promise<PoseResult | null> {
    const startedAt = performance.now();
    const poses = await this.detector.estimatePoses(video, { flipHorizontal: false }, timestamp);
    const pose = poses[0];
    return mapWebBlazePose({
      keypoints: pose?.keypoints,
      keypoints3D: pose?.keypoints3D,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      timestamp,
      inferenceLatencyMs: performance.now() - startedAt,
      cameraFacing,
    });
  }

  resetForCameraSourceChange(): void {
    this.detector.reset();
  }

  dispose(): void {
    this.detector.dispose();
  }
}
