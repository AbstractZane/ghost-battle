import { describe, expect, it } from 'vitest';

import { normalizeMoveNetOutput } from './moveNet';
import { projectLandmarkToPreview, SKELETON_EDGES } from './poseProjection';

describe('canonical pose and preview projection', () => {
  it('connects every anatomical limb without cross-side edges', () => {
    expect(SKELETON_EDGES).toContainEqual(['leftShoulder', 'leftElbow']);
    expect(SKELETON_EDGES).toContainEqual(['leftElbow', 'leftWrist']);
    expect(SKELETON_EDGES).toContainEqual(['rightShoulder', 'rightElbow']);
    expect(SKELETON_EDGES).toContainEqual(['rightElbow', 'rightWrist']);
    expect(SKELETON_EDGES).toContainEqual(['leftHip', 'leftKnee']);
    expect(SKELETON_EDGES).toContainEqual(['rightHip', 'rightKnee']);
    expect(SKELETON_EDGES).not.toContainEqual(['leftShoulder', 'rightElbow']);
    expect(SKELETON_EDGES).not.toContainEqual(['rightHip', 'leftKnee']);
  });

  it('mirrors only display projection while preserving detector identity', () => {
    const canonical = { x: 0.2, y: 0.4 };
    const back = projectLandmarkToPreview(canonical, {
      sourceWidth: 100,
      sourceHeight: 100,
      viewportWidth: 100,
      viewportHeight: 100,
      displayMirrored: false,
    });
    const front = projectLandmarkToPreview(canonical, {
      sourceWidth: 100,
      sourceHeight: 100,
      viewportWidth: 100,
      viewportHeight: 100,
      displayMirrored: true,
    });
    expect(back.x).toBeCloseTo(20);
    expect(front.x).toBeCloseTo(80);
    expect(canonical.x).toBe(0.2);
  });

  it('corrects mirrored model input once, then mirrors once for a front preview', () => {
    const output = new Array<number>(51).fill(0);
    output[15] = 0.4;
    output[16] = 0.8;
    output[17] = 1;
    const result = normalizeMoveNetOutput(output, 1, 2, {
      sourceWidth: 100,
      sourceHeight: 100,
      cameraFacing: 'front',
      orientation: 'up',
      inputMirrored: true,
      displayMirrored: true,
      poseModel: 'movenet-lightning',
    });
    expect(result?.rawLandmarks.leftShoulder?.x).toBeCloseTo(0.8);
    expect(result?.landmarks.leftShoulder?.x).toBeCloseTo(0.2);
    const display = projectLandmarkToPreview(result?.landmarks.leftShoulder ?? { x: 0, y: 0 }, {
      sourceWidth: 100,
      sourceHeight: 100,
      viewportWidth: 100,
      viewportHeight: 100,
      displayMirrored: result?.displayMirrored ?? false,
    });
    expect(display.x).toBeCloseTo(80);
  });

  it('keeps detector coordinates identical when switching between front and back cameras', () => {
    const backOutput = new Array<number>(51).fill(0);
    backOutput[15] = 0.4;
    backOutput[16] = 0.2;
    backOutput[17] = 1;
    const frontOutput = [...backOutput];
    frontOutput[16] = 0.8;
    const back = normalizeMoveNetOutput(backOutput, 1, 2, {
      sourceWidth: 100,
      sourceHeight: 100,
      cameraFacing: 'back',
      orientation: 'up',
      inputMirrored: false,
      displayMirrored: false,
      poseModel: 'movenet-thunder',
    });
    const front = normalizeMoveNetOutput(frontOutput, 1, 2, {
      sourceWidth: 100,
      sourceHeight: 100,
      cameraFacing: 'front',
      orientation: 'up',
      inputMirrored: true,
      displayMirrored: true,
      poseModel: 'movenet-thunder',
    });
    expect(back?.landmarks.leftShoulder?.y).toBe(front?.landmarks.leftShoulder?.y);
    expect(back?.landmarks.leftShoulder?.confidence).toBe(
      front?.landmarks.leftShoulder?.confidence,
    );
    expect(front?.landmarks.leftShoulder?.x).toBeCloseTo(0.2);
    expect(back?.landmarks.leftShoulder?.x).toBeCloseTo(0.2);
  });

  it('uses the same center-cover crop as the camera preview', () => {
    const center = projectLandmarkToPreview(
      { x: 0.5, y: 0.25 },
      {
        sourceWidth: 200,
        sourceHeight: 100,
        viewportWidth: 100,
        viewportHeight: 100,
        displayMirrored: false,
      },
    );
    expect(center).toEqual({ x: 50, y: 50 });
    const leftEdge = projectLandmarkToPreview(
      { x: 0, y: 0.25 },
      {
        sourceWidth: 200,
        sourceHeight: 100,
        viewportWidth: 100,
        viewportHeight: 100,
        displayMirrored: false,
      },
    );
    expect(leftEdge.x).toBe(-50);
  });

  it('letterboxes a full-body source with contain projection on web', () => {
    const topLeft = projectLandmarkToPreview(
      { x: 0, y: 0 },
      {
        sourceWidth: 640,
        sourceHeight: 480,
        viewportWidth: 1000,
        viewportHeight: 1000,
        displayMirrored: false,
        resizeMode: 'contain',
      },
    );
    expect(topLeft).toEqual({ x: 0, y: 125 });
  });

  it('mirrors a 4:3 preview without changing isotropic detector coordinates', () => {
    const canonical = { x: 160 / 640, y: 120 / 640 };
    const back = projectLandmarkToPreview(canonical, {
      sourceWidth: 640,
      sourceHeight: 480,
      viewportWidth: 640,
      viewportHeight: 480,
      displayMirrored: false,
      resizeMode: 'contain',
    });
    const front = projectLandmarkToPreview(canonical, {
      sourceWidth: 640,
      sourceHeight: 480,
      viewportWidth: 640,
      viewportHeight: 480,
      displayMirrored: true,
      resizeMode: 'contain',
    });
    expect(back).toEqual({ x: 160, y: 120 });
    expect(front).toEqual({ x: 480, y: 120 });
    expect(canonical).toEqual({ x: 0.25, y: 0.1875 });
  });
});
