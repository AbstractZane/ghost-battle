import { describe, expect, it } from 'vitest';
import { DETECTOR_LAB_CANDIDATES } from '@/debug/detectorLabCandidates';
import { PoseEngineV3 } from '@/pose/poseEngineV3';
import { projectedPlankAt } from './frontViewFixtures';

describe('lab projected-plank acquisition', () => {
  it.each(DETECTOR_LAB_CANDIDATES)(
    '$id counts three complete projected cycles without double counts',
    (profile) => {
      const detector = profile.create();
      const engine = new PoseEngineV3();
      const cycle = [
        ...Array<number>(24).fill(165),
        155,
        145,
        125,
        105,
        85,
        75,
        75,
        75,
        90,
        115,
        140,
        155,
        165,
        165,
        165,
      ];
      const angles = [...cycle, ...cycle, ...cycle];
      const results = angles.map((angle, index) => {
        const pose = engine.update(projectedPlankAt(angle, index * 60))!;
        const input = profile.input === 'raw' ? pose.rawPose : pose.detectorPose;
        return detector.processPose(input, input.timestamp);
      });
      expect(results.filter((result) => result.repCompleted)).toHaveLength(3);
      expect(results.at(-1)?.totalReps).toBe(3);
    },
  );
  it.each(DETECTOR_LAB_CANDIDATES)(
    '$id rejects a strongly folded projected knee with a supporting ankle',
    (profile) => {
      const detector = profile.create();
      const engine = new PoseEngineV3();
      const angles = [
        ...Array<number>(24).fill(165),
        155,
        145,
        125,
        105,
        85,
        75,
        75,
        75,
        90,
        115,
        140,
        155,
        165,
        165,
        165,
      ];
      const results = angles.map((angle, index) => {
        const pose = engine.update(projectedPlankAt(angle, index * 60, false, 0.27, 30))!;
        const input = profile.input === 'raw' ? pose.rawPose : pose.detectorPose;
        return detector.processPose(input, input.timestamp);
      });
      expect(results.at(-1)?.totalReps).toBe(0);
    },
  );

  it.each(DETECTOR_LAB_CANDIDATES)(
    '$id preserves complete reps with a supporting 0.27 ankle',
    (profile) => {
      const detector = profile.create();
      const engine = new PoseEngineV3();
      const angles = [
        ...Array<number>(24).fill(165),
        155,
        145,
        125,
        105,
        85,
        75,
        75,
        75,
        90,
        115,
        140,
        155,
        165,
        165,
        165,
      ];
      const results = angles.map((angle, index) => {
        const pose = engine.update(projectedPlankAt(angle, index * 60, false, 0.27))!;
        const input = profile.input === 'raw' ? pose.rawPose : pose.detectorPose;
        return detector.processPose(input, input.timestamp);
      });
      expect(results.at(-1)?.totalReps).toBe(1);
    },
  );

  it.each(DETECTOR_LAB_CANDIDATES)('$id rejects sustained projected knee support', (profile) => {
    const detector = profile.create();
    const engine = new PoseEngineV3();
    const angles = [
      ...Array<number>(24).fill(165),
      155,
      145,
      125,
      105,
      85,
      75,
      75,
      75,
      90,
      115,
      140,
      155,
      165,
      165,
      165,
    ];
    const results = angles.map((angle, index) => {
      const pose = engine.update(projectedPlankAt(angle, index * 60, false, 0.95, 90))!;
      const input = profile.input === 'raw' ? pose.rawPose : pose.detectorPose;
      return detector.processPose(input, input.timestamp);
    });
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it.each(DETECTOR_LAB_CANDIDATES)(
    '$id does not turn the posture alternative into a shallow-rep bypass',
    (profile) => {
      const detector = profile.create();
      const engine = new PoseEngineV3();
      const angles = [
        ...Array<number>(24).fill(165),
        155,
        145,
        132,
        125,
        125,
        125,
        132,
        145,
        155,
        165,
        165,
        165,
      ];
      const results = angles.map((angle, index) => {
        const pose = engine.update(projectedPlankAt(angle, index * 60))!;
        const input = profile.input === 'raw' ? pose.rawPose : pose.detectorPose;
        return detector.processPose(input, input.timestamp);
      });
      expect(results.at(-1)?.totalReps).toBe(0);
    },
  );

  it.each(DETECTOR_LAB_CANDIDATES)(
    '$id counts a vertically projected complete cycle without lowering depth',
    (profile) => {
      const detector = profile.create();
      const engine = new PoseEngineV3();
      const angles = [
        ...Array<number>(24).fill(165),
        155,
        145,
        125,
        105,
        85,
        75,
        75,
        75,
        90,
        115,
        140,
        155,
        165,
        165,
        165,
      ];
      const results = angles.map((angle, index) => {
        const pose = engine.update(projectedPlankAt(angle, index * 60))!;
        const input = profile.input === 'raw' ? pose.rawPose : pose.detectorPose;
        return detector.processPose(input, input.timestamp);
      });
      expect(results.at(-1)?.totalReps).toBe(1);
    },
  );

  it.each(DETECTOR_LAB_CANDIDATES)('$id rejects upright projected arm cycles', (profile) => {
    const detector = profile.create();
    const engine = new PoseEngineV3();
    const angles = [
      ...Array<number>(24).fill(165),
      155,
      145,
      125,
      105,
      85,
      75,
      75,
      75,
      90,
      115,
      140,
      155,
      165,
      165,
      165,
    ];
    const results = angles.map((angle, index) => {
      const pose = engine.update(projectedPlankAt(angle, index * 60, true))!;
      const input = profile.input === 'raw' ? pose.rawPose : pose.detectorPose;
      return detector.processPose(input, input.timestamp);
    });
    expect(results.at(-1)?.totalReps).toBe(0);
  });
});
