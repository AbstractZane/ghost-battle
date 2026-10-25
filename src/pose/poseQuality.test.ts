import { describe, expect, it } from 'vitest';

import { poseAt } from '@/tests/poseFixtures';

import {
  evaluatePoseQuality,
  poseSourceGeometry,
  StablePoseReadiness,
  type PoseReadinessThresholds,
} from './poseQuality';
import { StableSideSelector } from './sideSelector';
import type { PoseLandmarks } from './poseTypes';

const THRESHOLDS: PoseReadinessThresholds = {
  individualCoreFloor: 0.18,
  coreAggregate: 0.3,
  supporting: 0.22,
  bilateralCore: 0.5,
  minimumCoreSegmentLength: 0.015,
  minimumTorsoLength: 0.04,
  maximumTorsoLength: 0.8,
  minimumArmToTorsoRatio: 0.12,
  maximumArmToTorsoRatio: 2.5,
  maximumBilateralSeparationToTorsoRatio: 0.75,
};

const SIDE_THRESHOLDS = {
  individualCoreFloor: THRESHOLDS.individualCoreFloor,
  coreAggregate: THRESHOLDS.coreAggregate,
  sustainedFailureMs: 1200,
};

const LEFT_SIDE = ['leftShoulder', 'leftElbow', 'leftWrist', 'leftHip', 'leftKnee', 'leftAnkle'];
const RIGHT_SIDE = [
  'rightShoulder',
  'rightElbow',
  'rightWrist',
  'rightHip',
  'rightKnee',
  'rightAnkle',
];

function qualityAt(
  timestamp: number,
  options: Parameters<typeof poseAt>[2] = {},
  side: 'left' | 'right' = 'left',
) {
  const pose = poseAt(165, timestamp, options);
  return evaluatePoseQuality(pose.landmarks, side, THRESHOLDS, pose);
}

function setConfidence(landmarks: PoseLandmarks, names: string[], confidence: number): void {
  for (const name of names) {
    const landmark = landmarks[name as keyof PoseLandmarks];
    if (landmark) landmark.confidence = confidence;
  }
}

function separateRightSide(landmarks: PoseLandmarks): void {
  if (landmarks.rightShoulder) landmarks.rightShoulder.x = 0.82;
  if (landmarks.rightElbow) landmarks.rightElbow.x = 0.72;
  if (landmarks.rightWrist) landmarks.rightWrist.x = 0.62;
  if (landmarks.rightHip) landmarks.rightHip.x = 0.92;
}

describe('pose readiness', () => {
  it.each([
    [1920, 1080],
    [1440, 1080],
    [1080, 1920],
  ])('preserves %d x %d source geometry for every readiness consumer', (width, height) => {
    expect(
      poseSourceGeometry({
        sourceWidth: width,
        sourceHeight: height,
      }),
    ).toEqual({ sourceWidth: width, sourceHeight: height, canonicalCoordinates: true });
  });

  it('does not distort canonical live-camera geometry a second time in portrait', () => {
    const pose = poseAt(165, 0);
    const square = evaluatePoseQuality(
      pose.landmarks,
      'left',
      THRESHOLDS,
      poseSourceGeometry(pose),
    );
    const portrait = evaluatePoseQuality(
      pose.landmarks,
      'left',
      THRESHOLDS,
      poseSourceGeometry({ sourceWidth: 1080, sourceHeight: 1920 }),
    );
    expect(portrait.geometry?.shoulderHipDistance).toBe(square.geometry?.shoulderHipDistance);
    expect(portrait.geometry?.upperArmToTorsoRatio).toBe(square.geometry?.upperArmToTorsoRatio);
    expect(portrait.state).toBe(square.state);
  });

  it('accepts a valid side-view pose while the far side has low confidence', () => {
    const leftVisible = qualityAt(0, { preferredSide: 'left', missing: RIGHT_SIDE }, 'left');
    expect(leftVisible.state).toBe('READY');
    expect(leftVisible.geometry?.bilateralCheckApplied).toBe(false);
  });

  it('accepts a visible right side while the left side is extremely poor', () => {
    const rightVisible = qualityAt(0, { preferredSide: 'right', missing: LEFT_SIDE }, 'right');
    expect(rightVisible.state).toBe('READY');
  });

  it('does not let far-side separation block when the far side is unreliable', () => {
    const pose = poseAt(165, 0, { preferredSide: 'left' });
    separateRightSide(pose.landmarks);
    setConfidence(pose.landmarks, RIGHT_SIDE, 0.49);

    const result = evaluatePoseQuality(pose.landmarks, 'left', THRESHOLDS, pose);
    expect(result.state).toBe('READY');
    expect(result.geometry?.bilateralCheckApplied).toBe(false);
    expect(result.failureReason).toBeNull();
  });

  it('does not reject reliable tracking solely because the view exposes both sides', () => {
    const pose = poseAt(165, 0, { preferredSide: 'left' });
    separateRightSide(pose.landmarks);
    setConfidence(pose.landmarks, RIGHT_SIDE, 0.9);

    const result = evaluatePoseQuality(pose.landmarks, 'left', THRESHOLDS, pose);
    expect(result.state).toBe('READY');
    expect(result.geometry?.bilateralCheckApplied).toBe(true);
    expect(result.geometry?.bilateralSeparationToTorsoRatio).toBeGreaterThan(0.75);
    expect(result.failureReason).toBeNull();
    expect(result.geometry?.failure).toBeNull();
  });

  it('distinguishes the individual core floor from the core aggregate threshold', () => {
    const individualPose = poseAt(165, 0);
    if (individualPose.landmarks.leftWrist) individualPose.landmarks.leftWrist.confidence = 0.1;
    const individual = evaluatePoseQuality(
      individualPose.landmarks,
      'left',
      THRESHOLDS,
      individualPose,
    );
    expect(individual.failureReason).toBe('INDIVIDUAL CORE FLOOR: LEFT WRIST 0.10 < 0.18');

    const aggregatePose = poseAt(165, 0);
    setConfidence(aggregatePose.landmarks, LEFT_SIDE.slice(0, 4), 0.25);
    const aggregate = evaluatePoseQuality(
      aggregatePose.landmarks,
      'left',
      THRESHOLDS,
      aggregatePose,
    );
    expect(aggregate.failureReason).toBe('CORE AGGREGATE: LEFT 0.25 < 0.30');
  });

  it('does not use supporting landmarks as core readiness blockers', () => {
    const result = qualityAt(0, { missing: ['leftKnee', 'leftAnkle'] });
    expect(result.state).toBe('READY');
    expect(result.supportingScore).toBeLessThan(THRESHOLDS.supporting);
  });

  it('accepts normal top-pushup geometry and exposes all normalized metrics', () => {
    const result = qualityAt(0);
    expect(result.state).toBe('READY');
    expect(result.geometry).toMatchObject({
      coordinateSpace: 'aspect-corrected normalized source',
      failure: null,
    });
    expect(result.geometry?.shoulderElbowDistance).toBeCloseTo(0.18);
    expect(result.geometry?.elbowWristDistance).toBeCloseTo(0.18);
    expect(result.geometry?.shoulderHipDistance).toBeCloseTo(0.4);
    expect(result.geometry?.upperArmToTorsoRatio).toBeCloseTo(0.45);
  });

  it('reports the exact failed geometry metric, value, range, and coordinate space', () => {
    const pose = poseAt(165, 0);
    pose.landmarks.leftElbow = { ...pose.landmarks.leftShoulder!, confidence: 0.95 };
    const result = evaluatePoseQuality(pose.landmarks, 'left', THRESHOLDS, pose);

    expect(result.geometry?.failure).toEqual({
      metric: 'shoulder-elbow-distance',
      value: 0,
      minimum: 0.015,
      maximum: null,
    });
    expect(result.failureReason).toContain('shoulder-elbow-distance=0.0000');
    expect(result.failureReason).toContain('accepted >= 0.0150');
    expect(result.failureReason).toContain('aspect-corrected normalized source');
  });

  it('produces the same readiness geometry in equivalent normalized source spaces', () => {
    const square: PoseLandmarks = {
      leftShoulder: { x: 0.1, y: 0.3, confidence: 0.95 },
      leftElbow: { x: 0.2, y: 0.3, confidence: 0.95 },
      leftWrist: { x: 0.3, y: 0.3, confidence: 0.95 },
      leftHip: { x: 0.35, y: 0.3, confidence: 0.95 },
    };
    const portrait: PoseLandmarks = Object.fromEntries(
      Object.entries(square).map(([name, landmark]) => [name, { ...landmark, x: landmark.x * 2 }]),
    );
    const squareResult = evaluatePoseQuality(square, 'left', THRESHOLDS, {
      sourceWidth: 200,
      sourceHeight: 200,
    });
    const portraitResult = evaluatePoseQuality(portrait, 'left', THRESHOLDS, {
      sourceWidth: 100,
      sourceHeight: 200,
    });

    expect(squareResult.state).toBe('READY');
    expect(portraitResult.state).toBe('READY');
    expect(portraitResult.geometry?.shoulderHipDistance).toBeCloseTo(
      squareResult.geometry?.shoulderHipDistance ?? 0,
    );
    expect(portraitResult.geometry?.upperArmToTorsoRatio).toBeCloseTo(
      squareResult.geometry?.upperArmToTorsoRatio ?? 0,
    );
  });

  it('requires readiness to remain stable before becoming ready', () => {
    const tracker = new StablePoseReadiness({
      readyConfirmationMs: 200,
      landmarkGraceMs: 300,
      messageHoldMs: 750,
    });

    expect(tracker.update(qualityAt(0), 0).state).toBe('POSITIONING');
    expect(tracker.update(qualityAt(199), 199).state).toBe('POSITIONING');
    expect(tracker.update(qualityAt(200), 200).state).toBe('READY');
  });

  it('holds a stable READY state for at least two seconds on a valid pose', () => {
    const tracker = new StablePoseReadiness();
    expect(tracker.update(qualityAt(0), 0).state).toBe('POSITIONING');
    expect(tracker.update(qualityAt(500), 500).state).toBe('READY');
    expect(tracker.update(qualityAt(1500), 1500).state).toBe('READY');
    expect(tracker.update(qualityAt(2500), 2500).state).toBe('READY');
  });

  it('keeps readiness through a briefly lost landmark and expires after the grace period', () => {
    const tracker = new StablePoseReadiness({
      readyConfirmationMs: 200,
      landmarkGraceMs: 300,
      messageHoldMs: 750,
    });
    tracker.update(qualityAt(0), 0);
    tracker.update(qualityAt(200), 200);

    const briefLoss = tracker.update(qualityAt(300, { missing: ['leftWrist'] }), 300);
    const extendedLoss = tracker.update(qualityAt(501, { missing: ['leftWrist'] }), 501);

    expect(briefLoss.state).toBe('READY');
    expect(briefLoss.failureReason).toBe('INDIVIDUAL CORE FLOOR: LEFT WRIST 0.05 < 0.18');
    expect(extendedLoss.state).toBe('POSITIONING');
  });

  it('keeps readiness through a short core aggregate dip', () => {
    const tracker = new StablePoseReadiness({
      readyConfirmationMs: 400,
      landmarkGraceMs: 300,
      messageHoldMs: 750,
    });

    expect(tracker.update(qualityAt(0, { confidence: 0.34 }), 0).state).toBe('POSITIONING');
    expect(tracker.update(qualityAt(150, { confidence: 0.28 }), 150).state).toBe('POSITIONING');
    expect(tracker.update(qualityAt(400, { confidence: 0.33 }), 400).state).toBe('READY');
    expect(tracker.update(qualityAt(500, { confidence: 0.29 }), 500).state).toBe('READY');
  });

  it('holds one user-facing positioning message without hiding the current diagnostic', () => {
    const tracker = new StablePoseReadiness({
      readyConfirmationMs: 200,
      landmarkGraceMs: 300,
      messageHoldMs: 750,
    });

    const shoulder = tracker.update(qualityAt(0, { missing: ['leftShoulder'] }), 0);
    const held = tracker.update(qualityAt(100, { missing: ['leftWrist'] }), 100);
    const changed = tracker.update(qualityAt(800, { missing: ['leftWrist'] }), 800);

    expect(shoulder.feedback).toBe('SHOW LEFT SHOULDER');
    expect(held.feedback).toBe('SHOW LEFT SHOULDER');
    expect(held.failureReason).toContain('LEFT WRIST');
    expect(changed.feedback).toBe('SHOW LEFT WRIST');
  });
});

describe('side selection', () => {
  it('locks the usable selected side through short confidence reversals', () => {
    const selector = new StableSideSelector();
    const right = poseAt(165, 0, { preferredSide: 'right' });
    const temporaryLeft = poseAt(165, 100, { preferredSide: 'left' });
    const laterLeft = poseAt(165, 2000, { preferredSide: 'left' });

    expect(selector.select(right.landmarks, 0, SIDE_THRESHOLDS).side).toBe('right');
    expect(selector.select(temporaryLeft.landmarks, 100, SIDE_THRESHOLDS).side).toBe('right');
    expect(selector.select(right.landmarks, 300, SIDE_THRESHOLDS).side).toBe('right');
    expect(selector.select(laterLeft.landmarks, 2000, SIDE_THRESHOLDS).side).toBe('right');
  });

  it('switches only after sustained selected-side failure and then remains locked', () => {
    const selector = new StableSideSelector();
    const left = poseAt(165, 0, { preferredSide: 'left' });
    const rightWithLostLeft = poseAt(165, 100, {
      preferredSide: 'right',
      missing: LEFT_SIDE,
    });

    expect(selector.select(left.landmarks, 0, SIDE_THRESHOLDS).side).toBe('left');
    expect(selector.select(rightWithLostLeft.landmarks, 100, SIDE_THRESHOLDS).side).toBe('left');
    expect(selector.select(rightWithLostLeft.landmarks, 1000, SIDE_THRESHOLDS).side).toBe('left');
    const switched = selector.select(rightWithLostLeft.landmarks, 1300, SIDE_THRESHOLDS);
    expect(switched.side).toBe('right');
    expect(switched.changed).toBe(true);
    expect(switched.alternativeBetterMs).toBe(1200);
    expect(selector.select(left.landmarks, 1350, SIDE_THRESHOLDS).side).toBe('right');
  });
});
