import { describe, expect, it } from 'vitest';
import { DETECTOR_LAB_CANDIDATES } from '@/debug/detectorLabCandidates';
import { validRepSequence } from '@/tests/poseFixtures';
import { PushupDetector } from './PushupDetector';
import { PushupDetectorV5 } from './v5/PushupDetectorV5';
import { PushupDetectorV6 } from './v6/PushupDetectorV6';
import {
  createWorkoutPushupDetector,
  DEFAULT_WORKOUT_DETECTOR_VERSION,
  getWorkoutPushupRules,
} from './workoutDetector';

describe('shared workout detector default', () => {
  it('uses the exact phone-tested Form profile, not permissive V6 Base', () => {
    const form = DETECTOR_LAB_CANDIDATES.find((candidate) => candidate.id === 'v6-form')!;
    const counter = createWorkoutPushupDetector();
    expect(DEFAULT_WORKOUT_DETECTOR_VERSION).toBe('v6');
    expect(counter).toBeInstanceOf(PushupDetectorV6);
    expect(counter.getRules()).toEqual(form.rules);
    expect(counter.getRules().v6BottomElbowAngle).toBe(85);
    expect(counter.getRules().v6RejectArmArtifacts).toBe(1);
  });

  it('keeps V4/V5 available as explicit rollback/reference choices', () => {
    expect(createWorkoutPushupDetector('v4')).toBeInstanceOf(PushupDetector);
    expect(createWorkoutPushupDetector('v5')).toBeInstanceOf(PushupDetectorV5);
    expect(getWorkoutPushupRules('v4').labAllowFrontViewPlank).toBe(0);
    expect(getWorkoutPushupRules('v5').labAllowFrontViewPlank).toBe(0);
  });

  it('does not share mutable counter state between workouts', () => {
    const first = createWorkoutPushupDetector();
    const second = createWorkoutPushupDetector();
    validRepSequence().forEach((pose) => first.processPose(pose));
    expect(first.processPose(validRepSequence(2000)[0]!).totalReps).toBe(1);
    expect(second.processPose(validRepSequence(2000)[0]!).totalReps).toBe(0);
  });
});
