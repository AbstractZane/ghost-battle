import { describe, expect, it } from 'vitest';
import type { ExerciseDetector } from '@/exercises/ExerciseDetector';
import { DETECTOR_LAB_CANDIDATES } from '@/debug/detectorLabCandidates';
import { poseAt, validRepSequence } from '@/tests/poseFixtures';
import type { PoseResult } from '@/pose/poseTypes';
import {
  DEFAULT_PUSHUP_RULES,
  LAB_V4_FLOW_RULES,
  LAB_V6_FORM_RULES,
  LAB_V6_STEADY_RULES,
} from '../pushupRules';
import { PositiveLegPushupDetector } from './PositiveLegPushupDetector';

function detector(id: string) {
  const profile = DETECTOR_LAB_CANDIDATES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error('Unknown lab profile');
  return profile.create();
}
function run(counter: ExerciseDetector, frames: PoseResult[]) {
  return frames.map((pose) => counter.processPose(pose, pose.timestamp));
}
function missingLegs(pose: PoseResult) {
  const landmarks = { ...pose.landmarks };
  for (const name of ['leftAnkle', 'rightAnkle'] as const)
    landmarks[name] = { ...landmarks[name]!, confidence: 0.05 };
  return { ...pose, landmarks, rawLandmarks: landmarks };
}
function weakKnees(pose: PoseResult) {
  const bent = poseAt(165, pose.timestamp, { kneeAngle: 90 });
  const landmarks = { ...pose.landmarks };
  for (const side of ['left', 'right'] as const) {
    landmarks[`${side}Hip`] = { ...landmarks[`${side}Hip`]!, confidence: 0.42 };
    landmarks[`${side}Knee`] = { ...landmarks[`${side}Knee`]!, confidence: 0.59 };
    landmarks[`${side}Ankle`] = { ...bent.landmarks[`${side}Ankle`]!, confidence: 0.24 };
  }
  return { ...pose, landmarks, rawLandmarks: landmarks };
}
function weakStanding(pose: PoseResult) {
  const landmarks = { ...pose.landmarks };
  for (const side of ['left', 'right'] as const) {
    const shoulder = landmarks[`${side}Shoulder`]!;
    for (const joint of ['Shoulder', 'Elbow', 'Wrist'] as const) {
      const name = `${side}${joint}` as const;
      landmarks[name] = { ...landmarks[name]!, y: landmarks[name]!.y - 0.28, confidence: 0.38 };
    }
    landmarks[`${side}Hip`] = {
      ...landmarks[`${side}Hip`]!,
      x: shoulder.x,
      y: 0.62,
      confidence: 0.38,
    };
    landmarks[`${side}Knee`] = { ...landmarks[`${side}Knee`]!, x: shoulder.x, y: 0.79 };
    landmarks[`${side}Ankle`] = { ...landmarks[`${side}Ankle`]!, x: shoulder.x, y: 0.96 };
  }
  return { ...pose, landmarks, rawLandmarks: landmarks };
}

describe('lab-only tuned candidates', () => {
  it('has eight distinct choices, independent instances, and unchanged production rules', () => {
    expect(new Set(DETECTOR_LAB_CANDIDATES.map((profile) => profile.id)).size).toBe(8);
    for (const profile of DETECTOR_LAB_CANDIDATES)
      expect(profile.create()).not.toBe(profile.create());
    expect(DEFAULT_PUSHUP_RULES.upElbowAngle).toBe(155);
    expect(DEFAULT_PUSHUP_RULES.downElbowAngle).toBe(90);
    expect(DEFAULT_PUSHUP_RULES.v6VariantLandmarkConfidence).toBe(0.45);
    expect(DEFAULT_PUSHUP_RULES.v6MinimumRepDurationMs).toBe(220);
    expect(LAB_V4_FLOW_RULES.lowerBodyLandmarkConfidence).toBe(
      DEFAULT_PUSHUP_RULES.lowerBodyLandmarkConfidence,
    );
    for (const rules of [LAB_V6_FORM_RULES, LAB_V6_STEADY_RULES]) {
      expect(rules.v6ReadyConfirmationMs).toBe(DEFAULT_PUSHUP_RULES.v6ReadyConfirmationMs);
      expect(rules.v6ArmLandmarkConfidence).toBe(DEFAULT_PUSHUP_RULES.v6ArmLandmarkConfidence);
    }
    expect(LAB_V6_FORM_RULES.v6BottomElbowAngle).toBe(85);
    expect(LAB_V6_STEADY_RULES.v6BottomElbowAngle).toBe(100);
  });

  it('keeps a synthetic slow full rep countable in every new V6 candidate', () => {
    for (const id of ['v6-form', 'v6-steady', 'v6-legs'])
      expect(run(detector(id), validRepSequence()).at(-1)?.totalReps).toBe(1);
  });

  it('Form sees knees with 0.42 hip, 0.59 knee and 0.24 supporting ankle without stricter readiness', () => {
    const frames = validRepSequence().map(weakKnees);
    expect(run(detector('v6'), frames).at(-1)?.totalReps).toBe(1);
    const results = run(detector('v6-form'), frames);
    expect(results.some((result) => result.metrics.armState === 'ARMED')).toBe(true);
    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('Form rejects sustained low-confidence standing arm cycles that Base cannot classify', () => {
    const frames = validRepSequence().map(weakStanding);
    expect(run(detector('v6'), frames).at(-1)?.totalReps).toBe(1);
    const results = run(detector('v6-form'), frames);
    expect(results.some((result) => result.rejectedReason === 'BODY_ALIGNMENT')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('does not veto a full rep for one upright-looking observation', () => {
    const frames = validRepSequence().map((pose, index) =>
      index === 4 ? weakStanding(pose) : pose,
    );
    expect(run(detector('v6-form'), frames).at(-1)?.totalReps).toBe(1);
  });

  it('Steady filters a sub-400ms cycle; Base remains responsive', () => {
    const frames = [
      [165, 0],
      [165, 180],
      [138, 220],
      [85, 280],
      [120, 360],
      [165, 500],
    ].map(([angle, time]) => poseAt(angle!, time!));
    expect(run(detector('v6'), frames).at(-1)?.totalReps).toBe(1);
    const results = run(detector('v6-steady'), frames);
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.some((result) => result.rejectedReason === 'MOVEMENT_TOO_FAST')).toBe(true);
  });

  it('Steady requires additional corroboration for a brief marginal-depth observation', () => {
    const frames = [
      [165, 0],
      [165, 180],
      [138, 300],
      [112, 400],
      [98, 470],
      [103, 490],
      [125, 510],
      [165, 800],
    ].map(([angle, time]) => poseAt(angle!, time!));
    expect(run(detector('v6'), frames).at(-1)?.totalReps).toBe(1);
    const results = run(detector('v6-steady'), frames);
    expect(results.some((result) => result.rejectedReason === 'INSUFFICIENT_DEPTH')).toBe(true);
  });

  it('Flow can acquire a 152-degree top and 95-degree bottom without relaxing body/leg visibility', () => {
    const frames = [
      [152, 0],
      [152, 400],
      [152, 500],
      [138, 620],
      [105, 720],
      [95, 850],
      [95, 1000],
      [115, 1100],
      [152, 1320],
      [152, 1420],
    ].map(([angle, time]) => poseAt(angle!, time!));
    expect(run(detector('v4'), frames).at(-1)?.totalReps).toBe(0);
    expect(run(detector('v4-flow'), frames).at(-1)?.totalReps).toBe(1);
    expect(run(detector('v4-flow'), frames.map(missingLegs)).at(-1)?.totalReps).toBe(0);
  });
});

describe('positive-leg contrast candidate', () => {
  it('keeps arm readiness but rejects hidden ankles rather than assuming standard support', () => {
    const frames = validRepSequence().map(missingLegs);
    expect(run(detector('v6'), frames).at(-1)?.totalReps).toBe(1);
    const results = run(new PositiveLegPushupDetector(), frames);
    expect(results.some((result) => result.metrics.armState === 'ARMED')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.some((result) => result.rejectedReason === 'VARIANT_UNCONFIRMED')).toBe(true);
    expect(results.some((result) => result.repCompleted)).toBe(false);
    expect(results.every((result) => result.qualityScore === undefined)).toBe(true);
  });

  it('does not reuse previously visible straight legs at an occluded completion', () => {
    const frames = validRepSequence().map((pose, index) => (index >= 8 ? missingLegs(pose) : pose));
    expect(run(new PositiveLegPushupDetector(), frames).at(-1)?.totalReps).toBe(0);
  });

  it('rejects predicted/rejected leg joints even if a caller also marks them fresh', () => {
    for (const field of ['predictedLandmarks', 'rejectedLandmarks'] as const) {
      const frames = validRepSequence().map((pose): PoseResult => ({
        ...pose,
        tracking: {
          signalQuality: 'GOOD',
          freshLandmarks: [
            'leftShoulder',
            'leftElbow',
            'leftWrist',
            'leftHip',
            'leftKnee',
            'leftAnkle',
            'rightShoulder',
            'rightElbow',
            'rightWrist',
            'rightHip',
            'rightKnee',
            'rightAnkle',
          ],
          lastReliableTimestamp: pose.timestamp,
          [field]: ['leftAnkle', 'rightAnkle'],
        },
      }));
      expect(run(new PositiveLegPushupDetector(), frames).at(-1)?.totalReps).toBe(0);
    }
  });

  it('caps support confidence by raw observations without changing input landmarks', () => {
    const frames = validRepSequence().map((pose) => ({
      ...pose,
      rawLandmarks: missingLegs(pose).landmarks,
    }));
    const before = JSON.stringify(frames);
    expect(run(new PositiveLegPushupDetector(), frames).at(-1)?.totalReps).toBe(0);
    expect(JSON.stringify(frames)).toBe(before);
  });

  it('numbers accepted reps independently of refused arm cycles and ignores duplicate timestamps', () => {
    const counter = new PositiveLegPushupDetector();
    run(counter, validRepSequence().map(missingLegs));
    const accepted = run(counter, validRepSequence(2000)).find((result) => result.repCompleted);
    expect(accepted?.totalReps).toBe(1);
    expect(accepted?.rep?.index).toBe(1);
    expect(counter.processPose(poseAt(85, 3320), 3320).totalReps).toBe(1);
    counter.reset();
    expect(run(counter, validRepSequence()).at(-1)?.totalReps).toBe(1);
  });

  it('cannot stitch positive support or arm candidates over pauses and timestamp gaps', () => {
    for (const pause of [false, true]) {
      const counter = new PositiveLegPushupDetector();
      run(counter, validRepSequence().slice(0, 6));
      if (pause) {
        counter.setPaused(true);
        counter.setPaused(false);
      }
      const results = run(counter, [poseAt(165, 3000), poseAt(165, 3200)]);
      expect(results.every((result) => !result.repCompleted)).toBe(true);
      expect(results.at(-1)?.totalReps).toBe(0);
    }
  });
});
