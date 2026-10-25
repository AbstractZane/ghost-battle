import { describe, expect, it } from 'vitest';

import { poseAt } from '@/tests/poseFixtures';

import { PoseEngineV3 } from './poseEngineV3';
import { PoseJitterBenchmark } from './poseMetrics';

describe('PoseEngineV3', () => {
  it('uses stronger stationary smoothing for display than detector output', () => {
    const engine = new PoseEngineV3();
    const first = engine.update(poseAt(165, 0));
    const noisy = poseAt(165, 67);
    noisy.landmarks.leftWrist!.x += 0.01;
    const frame = engine.update(noisy);

    const rawDelta = Math.abs(
      (frame?.rawPose.landmarks.leftWrist?.x ?? 0) - (first?.rawPose.landmarks.leftWrist?.x ?? 0),
    );
    const detectorDelta = Math.abs(
      (frame?.detectorPose.landmarks.leftWrist?.x ?? 0) -
        (first?.detectorPose.landmarks.leftWrist?.x ?? 0),
    );
    const displayDelta = Math.abs(
      (frame?.displayPose.landmarks.leftWrist?.x ?? 0) -
        (first?.displayPose.landmarks.leftWrist?.x ?? 0),
    );
    expect(displayDelta).toBeLessThan(detectorDelta);
    expect(detectorDelta).toBeLessThan(rawDelta);
  });

  it('adapts smoothing strength to landmark confidence', () => {
    const highConfidenceEngine = new PoseEngineV3();
    const lowConfidenceEngine = new PoseEngineV3();
    highConfidenceEngine.update(poseAt(165, 0));
    lowConfidenceEngine.update(poseAt(165, 0));
    const highConfidence = poseAt(165, 67);
    const lowConfidence = poseAt(165, 67);
    highConfidence.landmarks.leftWrist!.x += 0.02;
    lowConfidence.landmarks.leftWrist!.x += 0.02;
    lowConfidence.landmarks.leftWrist!.confidence = 0.3;
    const high = highConfidenceEngine.update(highConfidence);
    const low = lowConfidenceEngine.update(lowConfidence);
    const origin = poseAt(165, 0).landmarks.leftWrist!.x;
    expect(Math.abs((low?.displayPose.landmarks.leftWrist?.x ?? 0) - origin)).toBeLessThan(
      Math.abs((high?.displayPose.landmarks.leftWrist?.x ?? 0) - origin),
    );
  });

  it('rejects an isolated one-frame wrist teleport', () => {
    const engine = new PoseEngineV3();
    const first = engine.update(poseAt(165, 0));
    const spike = poseAt(165, 67);
    spike.landmarks.leftWrist!.x = 0.99;
    const frame = engine.update(spike);

    expect(frame?.detectorPose.tracking?.rejectedLandmarks).toContain('leftWrist');
    expect(frame?.detectorPose.tracking?.freshLandmarks).not.toContain('leftWrist');
    expect(frame?.displayPose.landmarks.leftWrist?.x).toBeCloseTo(
      first?.displayPose.landmarks.leftWrist?.x ?? 0,
    );
  });

  it('predicts a short occlusion, fades confidence, then stops inventing the joint', () => {
    const engine = new PoseEngineV3();
    engine.update(poseAt(165, 0));
    engine.update(poseAt(140, 67));
    const occluded = engine.update(poseAt(120, 167, { missing: ['leftWrist'] }));
    const expired = engine.update(poseAt(120, 368, { missing: ['leftWrist'] }));

    expect(occluded?.displayPose.landmarks.leftWrist).toBeDefined();
    expect(occluded?.displayPose.tracking?.predictedLandmarks).toContain('leftWrist');
    expect(occluded?.displayPose.landmarks.leftWrist?.confidence).toBeLessThan(0.95);
    expect(expired?.displayPose.landmarks.leftWrist).toBeUndefined();
  });

  it('rapidly reacquires two consistent high-confidence frames after an apparent jump', () => {
    const engine = new PoseEngineV3();
    engine.update(poseAt(165, 0));
    const moved = poseAt(165, 67);
    moved.landmarks.leftWrist!.x = 0.95;
    expect(engine.update(moved)?.detectorPose.tracking?.rejectedLandmarks).toContain('leftWrist');
    const confirmation = poseAt(165, 134);
    confirmation.landmarks.leftWrist!.x = 0.95;
    const reacquired = engine.update(confirmation);
    expect(reacquired?.detectorPose.tracking?.freshLandmarks).toContain('leftWrist');
    expect(reacquired?.detectorPose.landmarks.leftWrist?.x).toBeGreaterThan(0.8);
  });

  it('follows credible fast motion more tightly in the detector path', () => {
    const engine = new PoseEngineV3();
    engine.update(poseAt(165, 0));
    const moved = poseAt(110, 67);
    const frame = engine.update(moved);
    const target = moved.landmarks.leftWrist!.y;
    const detectorError = Math.abs((frame?.detectorPose.landmarks.leftWrist?.y ?? 0) - target);
    const displayError = Math.abs((frame?.displayPose.landmarks.leftWrist?.y ?? 0) - target);
    expect(detectorError).toBeLessThan(displayError);
  });

  it('preserves anatomical left/right identity through confidence reversal', () => {
    const engine = new PoseEngineV3();
    const first = poseAt(165, 0);
    first.landmarks.leftWrist!.x = 0.2;
    first.landmarks.rightWrist!.x = 0.8;
    engine.update(first);
    const reversedConfidence = poseAt(165, 67, { preferredSide: 'right' });
    reversedConfidence.landmarks.leftWrist!.x = 0.21;
    reversedConfidence.landmarks.rightWrist!.x = 0.79;
    const frame = engine.update(reversedConfidence);
    expect(frame?.displayPose.landmarks.leftWrist?.x).toBeLessThan(0.4);
    expect(frame?.displayPose.landmarks.rightWrist?.x).toBeGreaterThan(0.6);
  });

  it('softens a bone-length anomaly without rigidly locking the limb', () => {
    const engine = new PoseEngineV3({ outlierDistance: 1 });
    const first = engine.update(poseAt(165, 0));
    const anomaly = poseAt(165, 67);
    anomaly.landmarks.leftWrist!.x += 0.35;
    const frame = engine.update(anomaly);
    const elbow = frame?.displayPose.landmarks.leftElbow;
    const wrist = frame?.displayPose.landmarks.leftWrist;
    const priorElbow = first?.displayPose.landmarks.leftElbow;
    const priorWrist = first?.displayPose.landmarks.leftWrist;
    const length = elbow && wrist ? Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y) : 0;
    const priorLength =
      priorElbow && priorWrist
        ? Math.hypot(priorWrist.x - priorElbow.x, priorWrist.y - priorElbow.y)
        : 0;
    expect(length).toBeLessThan(priorLength + 0.35);
    expect(length).toBeGreaterThan(priorLength);
  });

  it('drops out-of-order pose timestamps', () => {
    const engine = new PoseEngineV3();
    expect(engine.update(poseAt(165, 100))).not.toBeNull();
    expect(engine.update(poseAt(165, 99))).toBeNull();
    expect(engine.update(poseAt(165, 100))).toBeNull();
    expect(engine.update(poseAt(165, 101))).not.toBeNull();
  });

  it('reduces deterministic stationary jitter without feeding the display pose to detection', () => {
    const engine = new PoseEngineV3({ displayStillAlpha: 0.28, displayMotionAlpha: 0.82 });
    const benchmark = new PoseJitterBenchmark(0, 10_000);
    let result = null;
    for (let index = 0; index <= 150; index += 1) {
      const pose = poseAt(165, index * 67);
      const jitterX = Math.sin(index * 2.17) * 0.009 + Math.sin(index * 0.37) * 0.003;
      const jitterY = Math.cos(index * 1.73) * 0.008;
      for (const landmark of Object.values(pose.landmarks)) {
        if (!landmark) continue;
        landmark.x += jitterX;
        landmark.y += jitterY;
      }
      const frame = engine.update(pose);
      if (frame) result = benchmark.add(frame) ?? result;
    }
    expect(result).not.toBeNull();
    if (!result) throw new Error('Jitter benchmark did not complete.');
    expect(result.display.meanJointDisplacement).toBeLessThan(
      result.detector.meanJointDisplacement,
    );
    expect(result.detector.meanJointDisplacement).toBeLessThan(result.raw.meanJointDisplacement);
  });
});
