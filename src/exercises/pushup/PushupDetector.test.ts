import { describe, expect, it } from 'vitest';

import { poseAt, validRepSequence } from '@/tests/poseFixtures';

import { PushupDetector } from './PushupDetector';
import { DEFAULT_PUSHUP_RULES } from './pushupRules';

function standingPose(elbowAngle: number, timestamp: number) {
  const pose = poseAt(elbowAngle, timestamp);
  for (const landmark of Object.values(pose.landmarks)) {
    if (!landmark) continue;
    const originalX = landmark.x;
    const originalY = landmark.y;
    landmark.x = 0.5 - (originalY - 0.5);
    landmark.y = 0.5 + (originalX - 0.5);
  }
  return pose;
}

function run(detector: PushupDetector, poses: ReturnType<typeof validRepSequence>) {
  return poses.map((pose) => detector.processPose(pose, pose.timestamp));
}

function continuousRepSequence(cycleMs: number, repetitions: number) {
  const poses = [poseAt(165, 0), poseAt(165, 400)];
  for (let rep = 0; rep < repetitions; rep += 1) {
    const start = 400 + rep * cycleMs;
    poses.push(
      poseAt(140, start + cycleMs * 0.14),
      poseAt(82, start + cycleMs * 0.36),
      poseAt(115, start + cycleMs * 0.62),
      poseAt(165, start + cycleMs * 0.9),
    );
  }
  return poses;
}

describe('PushupDetector', () => {
  it('counts a sparse full cycle with no sampled intermediate ascent or descent', () => {
    const results = run(new PushupDetector(), [
      poseAt(165, 0),
      poseAt(165, 500),
      poseAt(82, 800),
      poseAt(165, 1100),
      poseAt(165, 1200),
    ]);
    expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
  });

  it('does not join a bottom to a top after camera delivery stops', () => {
    const detector = new PushupDetector();
    const results = run(detector, [
      poseAt(165, 0),
      poseAt(165, 500),
      poseAt(140, 620),
      poseAt(82, 800),
      poseAt(115, 1000),
      poseAt(165, 3000),
    ]);
    expect(results.some((result) => result.repCompleted)).toBe(false);
    expect(run(detector, validRepSequence(3200)).at(-1)?.totalReps).toBe(1);
  });

  it('ignores duplicate, backward and invalid timestamps without duplicating a rep', () => {
    const detector = new PushupDetector();
    run(detector, validRepSequence());
    for (const timestamp of [1420, 100, NaN, Infinity]) {
      const result = detector.processPose(poseAt(82, timestamp));
      expect(result.repCompleted).toBe(false);
      expect(result.rep).toBeUndefined();
      expect(result.totalReps).toBe(1);
    }
    expect(run(detector, validRepSequence(1600)).at(-1)?.totalReps).toBe(2);
  });

  it('does not arm on an invalid first timestamp and recovers on valid input', () => {
    const detector = new PushupDetector();
    expect(detector.processPose(poseAt(165, NaN)).metrics.armState).toBe('DISARMED');
    expect(run(detector, validRepSequence()).at(-1)?.totalReps).toBe(1);
  });
  it('counts one valid full-range rep exactly once', () => {
    const results = run(new PushupDetector(), validRepSequence());
    expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('counts several valid reps without duplicates', () => {
    const detector = new PushupDetector();
    run(detector, validRepSequence());
    const results = run(detector, validRepSequence(1600));
    expect(results.at(-1)?.totalReps).toBe(2);
  });

  it('counts a fast but valid rep without deliberate top or bottom pauses', () => {
    const detector = new PushupDetector();
    const sequence = [
      [165, 0],
      [165, 500],
      [140, 550],
      [85, 650],
      [85, 750],
      [115, 850],
      [165, 1000],
      [165, 1100],
    ].map(([angle, time]) => poseAt(angle ?? 165, time ?? 0));
    const results = run(detector, sequence);
    const result = results.find((frame) => frame.repCompleted);
    expect(results.at(-1)?.totalReps).toBe(1);
    expect(result?.rep?.durationMs).toBe(450);
    expect(result?.rep?.timestamp).toBe(1000);
  });

  it('counts a 350ms threshold-driven rep with one strong bottom frame and one top frame', () => {
    const detector = new PushupDetector();
    const sequence = [
      [165, 0],
      [165, 500],
      [140, 580],
      [82, 680],
      [115, 760],
      [165, 930],
    ].map(([angle, time]) => poseAt(angle ?? 165, time ?? 0));
    const completed = run(detector, sequence).find((result) => result.repCompleted);
    expect(completed?.rep?.durationMs).toBe(350);
    expect(completed?.rep?.timestamp).toBe(930);
  });

  it('counts 10 continuous reps without rearming or a lockout hold', () => {
    const detector = new PushupDetector();
    const poses = [poseAt(165, 0), poseAt(165, 500)];
    for (let rep = 0; rep < 10; rep += 1) {
      const start = 500 + rep * 430;
      poses.push(
        poseAt(140, start + 80),
        poseAt(82, start + 180),
        poseAt(115, start + 260),
        poseAt(165, start + 430),
      );
    }
    const results = run(detector, poses);
    expect(results.filter((result) => result.repCompleted)).toHaveLength(10);
    expect(results.at(-1)?.totalReps).toBe(10);
    expect(results.slice(2).every((result) => result.metrics.armState === 'ARMED')).toBe(true);
  });

  it.each([
    ['one rep every two seconds', 2000, 3],
    ['one rep per second', 1000, 5],
    ['two reps per second', 500, 6],
  ] as const)('counts %s with exactly one event per physical cycle', (_label, cycleMs, reps) => {
    const results = run(new PushupDetector(), continuousRepSequence(cycleMs, reps));
    expect(results.filter((result) => result.repCompleted)).toHaveLength(reps);
    expect(results.at(-1)?.totalReps).toBe(reps);
  });

  it('immediately accepts a new descent after a completed lockout', () => {
    const detector = new PushupDetector();
    const results = run(detector, continuousRepSequence(500, 2));
    const firstRepIndex = results.findIndex((result) => result.repCompleted);
    expect(results[firstRepIndex]?.state).toBe('UP');
    expect(results[firstRepIndex + 1]?.state).toBe('DESCENDING');
    expect(results.at(-1)?.totalReps).toBe(2);
  });

  it('counts a slow-fast-slow burst without cooldowns or duplicate counts', () => {
    const detector = new PushupDetector();
    const poses = [poseAt(165, 0), poseAt(165, 400)];
    let start = 400;
    for (const cycleMs of [1600, 500, 500, 1000, 1800]) {
      poses.push(
        poseAt(140, start + cycleMs * 0.14),
        poseAt(82, start + cycleMs * 0.36),
        poseAt(115, start + cycleMs * 0.62),
        poseAt(165, start + cycleMs * 0.9),
      );
      start += cycleMs;
    }
    const results = run(detector, poses);
    expect(results.filter((result) => result.repCompleted)).toHaveLength(5);
    expect(results.at(-1)?.totalReps).toBe(5);
  });

  it('counts a slow valid rep and does not impose multi-second state holds', () => {
    const detector = new PushupDetector();
    const results = run(detector, validRepSequence());
    expect(results.find((result) => result.repCompleted)?.rep?.timestamp).toBe(1320);
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('stays armed after a rep instead of repeating initial readiness', () => {
    const detector = new PushupDetector();
    run(detector, validRepSequence());
    const nextTop = detector.processPose(poseAt(165, 1500), 1500);
    expect(nextTop.metrics.armState).toBe('ARMED');
    expect(nextTop.state).toBe('UP');
  });

  it('does not count a half rep', () => {
    const detector = new PushupDetector();
    const sequence = [
      [165, 0],
      [165, 500],
      [140, 620],
      [140, 730],
      [120, 850],
      [150, 1000],
      [165, 1120],
      [165, 1230],
    ].map(([angle, time]) => poseAt(angle ?? 165, time ?? 0));
    expect(run(detector, sequence).at(-1)?.totalReps).toBe(0);
  });

  it('does not count while staying at the top or bottom', () => {
    const top = new PushupDetector();
    expect(
      run(
        top,
        [0, 500, 1000, 1500].map((time) => poseAt(165, time)),
      ).at(-1)?.totalReps,
    ).toBe(0);
    const bottom = new PushupDetector();
    expect(
      run(
        bottom,
        [0, 500, 1000, 1500].map((time) => poseAt(85, time)),
      ).at(-1)?.totalReps,
    ).toBe(0);
  });

  it('ignores threshold jitter and repeated identical frames', () => {
    const detector = new PushupDetector();
    const sequence = [
      [165, 0],
      [165, 500],
      [146, 620],
      [144, 660],
      [146, 700],
      [144, 740],
      [165, 900],
      [165, 1100],
    ].map(([angle, time]) => poseAt(angle ?? 165, time ?? 0));
    expect(run(detector, sequence).at(-1)?.totalReps).toBe(0);
  });

  it('allows a brief lost wrist but never counts during lost tracking', () => {
    const detector = new PushupDetector();
    const sequence = validRepSequence();
    sequence.splice(5, 0, poseAt(85, 900, { missing: ['leftWrist'] }));
    expect(run(detector, sequence).at(-1)?.totalReps).toBe(1);
  });

  it('preserves an active rep across one temporarily occluded elbow frame', () => {
    const detector = new PushupDetector();
    const sequence = validRepSequence();
    sequence.splice(6, 0, poseAt(100, 1020, { missing: ['leftElbow'] }));
    expect(run(detector, sequence).at(-1)?.totalReps).toBe(1);
  });

  it('rejects extended landmark loss', () => {
    const detector = new PushupDetector();
    const sequence = validRepSequence().slice(0, 5);
    run(detector, sequence);
    const lost = {
      signalQuality: 'LOST' as const,
      freshLandmarks: [],
      lastReliableTimestamp: 950,
    };
    detector.processPose(
      poseAt(85, 1000, {
        missing: ['leftWrist', 'rightWrist', 'leftAnkle', 'rightAnkle'],
        tracking: lost,
      }),
      1000,
    );
    const result = detector.processPose(
      poseAt(85, 1701, {
        missing: ['leftWrist', 'rightWrist', 'leftAnkle', 'rightAnkle'],
        tracking: lost,
      }),
      1701,
    );
    expect(result.metrics.armState).toBe('DISARMED');
    expect(result.rejectedReason).toBe('TRACKING_LOST');
    expect(result.totalReps).toBe(0);
  });

  it('rejects severe body alignment violations', () => {
    const results = run(new PushupDetector(), validRepSequence(0, { bodyAngle: 125 }));
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('requires a valid top starting position', () => {
    const detector = new PushupDetector();
    const sequence = [
      [120, 0],
      [85, 200],
      [85, 400],
      [120, 600],
      [165, 800],
      [165, 1000],
    ].map(([angle, time]) => poseAt(angle ?? 120, time ?? 0));
    expect(run(detector, sequence).at(-1)?.totalReps).toBe(0);
  });

  it('rejects an unrealistically instant rep', () => {
    const detector = new PushupDetector({
      ...DEFAULT_PUSHUP_RULES,
      armingConfirmationMs: 10,
      contextEntryConfirmationMs: 10,
      lowerBodyVariantConfirmationMs: 10,
      bottomConfirmationMs: 10,
      topConfirmationMs: 10,
      minimumRepDurationMs: 500,
    });
    const sequence = [
      [165, 0],
      [165, 10],
      [140, 20],
      [140, 30],
      [85, 40],
      [85, 50],
      [115, 60],
      [115, 70],
      [165, 80],
      [165, 90],
    ].map(([angle, time]) => poseAt(angle ?? 165, time ?? 0));
    const results = run(detector, sequence);
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.some((result) => result.rejectedReason === 'MOVEMENT_TOO_FAST')).toBe(true);
  });

  it('resets on pause/resume and does not count stale movement', () => {
    const detector = new PushupDetector();
    run(detector, validRepSequence().slice(0, 6));
    detector.setPaused(true);
    expect(detector.processPose(poseAt(165, 2000), 2000).feedback).toBe('PAUSED');
    detector.setPaused(false);
    expect(detector.processPose(poseAt(165, 2200), 2200).totalReps).toBe(0);
  });

  it('tracks left and right sides and uses the emergency delay only for total arm failure', () => {
    const detector = new PushupDetector();
    expect(
      detector.processPose(poseAt(165, 0, { preferredSide: 'left' }), 0).metrics.selectedSide,
    ).toBe('left');
    const hiddenLeft = [
      'leftShoulder',
      'leftElbow',
      'leftWrist',
      'leftHip',
      'leftKnee',
      'leftAnkle',
    ];
    detector.processPose(poseAt(165, 100, { preferredSide: 'right', missing: hiddenLeft }), 100);
    expect(
      detector.processPose(poseAt(165, 300, { preferredSide: 'right', missing: hiddenLeft }), 300)
        .metrics.selectedSide,
    ).toBe('right');
    expect(
      detector.processPose(poseAt(165, 500, { preferredSide: 'right', missing: hiddenLeft }), 500)
        .metrics.selectedSide,
    ).toBe('right');
    expect(
      detector.processPose(poseAt(165, 1300, { preferredSide: 'right', missing: hiddenLeft }), 1300)
        .metrics.selectedSide,
    ).toBe('right');
    expect(
      run(detector, validRepSequence(2000, { preferredSide: 'right' })).at(-1)?.totalReps,
    ).toBe(1);
  });

  it('rejects consistently low-confidence landmarks', () => {
    const detector = new PushupDetector();
    const results = run(
      detector,
      validRepSequence().map((pose) => poseAt(165, pose.timestamp, { confidence: 0.3 })),
    );
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('does not arm or count standing hoodie-like arm motion', () => {
    const detector = new PushupDetector();
    const angles = [165, 165, 140, 85, 85, 115, 165, 165, 130, 80, 120, 165];
    const results = angles.map((angle, index) =>
      detector.processPose(standingPose(angle, index * 150), index * 150),
    );
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.every((result) => result.metrics.armState === 'DISARMED')).toBe(true);
  });

  it('does not count repeated standing elbow bends', () => {
    const detector = new PushupDetector();
    const results = [165, 90, 165, 90, 165, 90, 165].map((angle, index) =>
      detector.processPose(standingPose(angle, index * 400), index * 400),
    );
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it.each(['waving', 'walking', 'crouching'] as const)(
    'does not count %s movement outside pushup context',
    (movement) => {
      const detector = new PushupDetector();
      const results = [165, 95, 150, 80, 165, 90, 165].map((angle, index) => {
        const pose = standingPose(angle, index * 180);
        if (movement === 'walking') {
          for (const landmark of Object.values(pose.landmarks)) {
            if (landmark) landmark.x += index * 0.01;
          }
        }
        if (movement === 'crouching') {
          for (const name of ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'] as const) {
            const landmark = pose.landmarks[name];
            if (landmark) landmark.y += 0.08;
          }
        }
        return detector.processPose(pose, pose.timestamp);
      });
      expect(results.at(-1)?.totalReps).toBe(0);
    },
  );

  it('does not count the transition from standing down onto the floor', () => {
    const detector = new PushupDetector();
    const results = [
      standingPose(165, 0),
      standingPose(120, 200),
      poseAt(90, 400),
      poseAt(115, 550),
      poseAt(165, 700),
    ].map((pose) => detector.processPose(pose, pose.timestamp));
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.at(-1)?.metrics.armState).not.toBe('ARMED');
  });

  it('disarms and clears a partial rep after leaving plank posture beyond grace', () => {
    const detector = new PushupDetector();
    detector.processPose(poseAt(165, 0), 0);
    detector.processPose(poseAt(165, 500), 500);
    detector.processPose(poseAt(140, 600), 600);
    detector.processPose(standingPose(85, 700), 700);
    detector.processPose(standingPose(85, 1301), 1301);
    const disarmed = detector.processPose(standingPose(85, 1402), 1402);
    expect(disarmed.metrics.armState).toBe('DISARMED');

    const staleFinish = [poseAt(115, 1200), poseAt(165, 1350), poseAt(165, 1500)].map((pose) =>
      detector.processPose(pose, pose.timestamp),
    );
    expect(staleFinish.at(-1)?.totalReps).toBe(0);
  });

  it('counts a full rep with a slight alignment issue and lowers its quality', () => {
    const detector = new PushupDetector();
    const results = run(detector, validRepSequence(0, { bodyAngle: 145 }));
    const result = results.find((frame) => frame.repCompleted);
    expect(results.at(-1)?.totalReps).toBe(1);
    expect(result?.rep?.qualityScore).toBeLessThan(90);
  });

  describe('standard versus knee-pushup eligibility', () => {
    it('classifies and counts a normal standard pushup', () => {
      const results = run(new PushupDetector(), validRepSequence());
      expect(results.at(-1)?.metrics.exerciseVariant).toBe('STANDARD');
      expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
    });

    it('rejects a knee pushup with strongly bent knees', () => {
      const results = run(new PushupDetector(), validRepSequence(0, { kneeAngle: 115 }));
      expect(results.at(-1)?.metrics.exerciseVariant).toBe('MODIFIED_KNEE');
      expect(results.at(-1)?.feedback).toBe('STRAIGHTEN YOUR LEGS');
      expect(results.at(-1)?.totalReps).toBe(0);
    });

    it('rejects repeated knee pushups', () => {
      const detector = new PushupDetector();
      const results = [0, 1600, 3200].flatMap((start) =>
        run(detector, validRepSequence(start, { kneeAngle: 110 })),
      );
      expect(results.filter((result) => result.repCompleted)).toHaveLength(0);
      expect(results.at(-1)?.totalReps).toBe(0);
    });

    it('rejects a rapidly performed knee pushup', () => {
      const sequence = [
        [165, 0],
        [165, 250],
        [140, 320],
        [82, 420],
        [115, 510],
        [165, 650],
      ].map(([angle, timestamp]) => poseAt(angle ?? 165, timestamp ?? 0, { kneeAngle: 115 }));
      const results = run(new PushupDetector(), sequence);
      expect(results.at(-1)?.metrics.exerciseVariant).toBe('MODIFIED_KNEE');
      expect(results.at(-1)?.totalReps).toBe(0);
    });

    it('allows a transition from knees into a confirmed standard position', () => {
      const detector = new PushupDetector();
      const positioning = [
        poseAt(165, 0, { kneeAngle: 115 }),
        poseAt(165, 250, { kneeAngle: 115 }),
        poseAt(165, 500, { kneeAngle: 115 }),
        poseAt(165, 700),
        poseAt(165, 950),
      ];
      run(detector, positioning);
      const results = run(detector, validRepSequence(1100));
      expect(results.at(-1)?.metrics.exerciseVariant).toBe('STANDARD');
      expect(results.at(-1)?.totalReps).toBe(1);
    });

    it('invalidates a standard rep after sustained transition onto the knees', () => {
      const detector = new PushupDetector();
      const sequence = [
        poseAt(165, 0),
        poseAt(165, 500),
        poseAt(140, 600, { kneeAngle: 115 }),
        poseAt(85, 820, { kneeAngle: 115 }),
        poseAt(115, 950, { kneeAngle: 115 }),
        poseAt(165, 1100, { kneeAngle: 115 }),
      ];
      const results = run(detector, sequence);
      expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
      expect(results.at(-1)?.totalReps).toBe(0);
    });

    it('tolerates one temporarily lost knee landmark', () => {
      const detector = new PushupDetector();
      const sequence = validRepSequence();
      sequence.splice(5, 0, poseAt(85, 900, { missing: ['leftKnee'] }));
      const results = run(detector, sequence);
      expect(results.at(-1)?.totalReps).toBe(1);
    });

    it('preserves standard context through temporary ankle occlusion during a rep', () => {
      const detector = new PushupDetector();
      const sequence = validRepSequence();
      sequence.splice(6, 0, poseAt(100, 1020, { missing: ['leftAnkle', 'rightAnkle'] }));
      const results = run(detector, sequence);
      expect(results[6]?.metrics.variantFrameEvidence).toBe('UNKNOWN');
      expect(results[6]?.metrics.exerciseVariant).toBe('STANDARD');
      expect(results.at(-1)?.totalReps).toBe(1);
    });

    it('does not reject a standard rep for one noisy bent-knee frame', () => {
      const detector = new PushupDetector();
      const sequence = validRepSequence();
      sequence.splice(5, 0, poseAt(85, 900, { kneeAngle: 115 }));
      const results = run(detector, sequence);
      expect(results[5]?.metrics.variantFrameEvidence).toBe('MODIFIED_KNEE');
      expect(results[5]?.metrics.exerciseVariant).toBe('STANDARD');
      expect(results.at(-1)?.totalReps).toBe(1);
    });

    it('accepts slightly bent legs when the ankle still extends the leg chain', () => {
      const results = run(new PushupDetector(), validRepSequence(0, { kneeAngle: 155 }));
      expect(results.at(-1)?.metrics.exerciseVariant).toBe('STANDARD');
      expect(results.at(-1)?.totalReps).toBe(1);
    });

    it('treats poor body form with extended legs as standard rather than knee-supported', () => {
      const results = run(
        new PushupDetector(),
        validRepSequence(0, { bodyAngle: 145, kneeAngle: 180 }),
      );
      expect(results.at(-1)?.metrics.exerciseVariant).toBe('STANDARD');
      expect(results.at(-1)?.totalReps).toBe(1);
      expect(results.find((result) => result.repCompleted)?.rep?.qualityScore).toBeLessThan(90);
    });

    it('does not count crawling into position with bent-knee arm motion', () => {
      const sequence = [120, 90, 115, 140, 165].map((angle, index) =>
        poseAt(angle, index * 120, { kneeAngle: 110 }),
      );
      expect(run(new PushupDetector(), sequence).at(-1)?.totalReps).toBe(0);
    });

    it('does not count repeated kneeling arm bends', () => {
      const sequence = [165, 90, 165, 90, 165, 90, 165].map((angle, index) =>
        poseAt(angle, index * 250, { kneeAngle: 110 }),
      );
      const results = run(new PushupDetector(), sequence);
      expect(results.some((result) => result.metrics.exerciseVariant === 'MODIFIED_KNEE')).toBe(
        true,
      );
      expect(results.at(-1)?.totalReps).toBe(0);
    });

    it('keeps immediate fast lockout-to-descent behavior for standard reps', () => {
      const detector = new PushupDetector();
      const results = run(detector, continuousRepSequence(500, 2));
      const firstRepIndex = results.findIndex((result) => result.repCompleted);
      expect(results[firstRepIndex]?.metrics.exerciseVariant).toBe('STANDARD');
      expect(results[firstRepIndex + 1]?.state).toBe('DESCENDING');
      expect(results.at(-1)?.totalReps).toBe(2);
    });
  });

  describe('V4 motion recovery and source continuity', () => {
    it('counts an irregularly sampled rep through conservative peak reversal', () => {
      const sequence = [
        [165, 0],
        [165, 500],
        [140, 580],
        [84, 680],
        [112, 780],
        [138, 840],
        [149, 900],
        [152, 960],
        [147, 1020],
        [135, 1100],
      ].map(([angle, timestamp]) => poseAt(angle ?? 165, timestamp ?? 0));
      const results = run(new PushupDetector(), sequence);
      expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
      expect(results.find((result) => result.repCompleted)?.metrics.recentPeakAngle).toBe(152);
    });

    it('does not count a rep whose sampled peak only reaches 145 degrees', () => {
      const sequence = [
        [165, 0],
        [165, 500],
        [140, 580],
        [84, 680],
        [112, 780],
        [135, 850],
        [143, 920],
        [145, 990],
        [140, 1060],
      ].map(([angle, timestamp]) => poseAt(angle ?? 165, timestamp ?? 0));
      expect(run(new PushupDetector(), sequence).at(-1)?.totalReps).toBe(0);
    });

    it('immediately uses the alternate arm while retaining the preferred side for one frame', () => {
      const detector = new PushupDetector();
      detector.processPose(poseAt(165, 0, { preferredSide: 'left' }), 0);
      detector.processPose(poseAt(165, 500, { preferredSide: 'left' }), 500);
      const fallback = detector.processPose(
        poseAt(140, 580, {
          preferredSide: 'right',
          missing: ['leftShoulder', 'leftElbow', 'leftWrist'],
        }),
        580,
      );
      expect(fallback.metrics.selectedSide).toBe('left');
      expect(fallback.metrics.elbowSource).toBe('right');
      expect(fallback.state).toBe('DESCENDING');
    });

    it('preserves a physical cycle through emergency preferred-side failover without duplicates', () => {
      const hiddenLeftArm = ['leftShoulder', 'leftElbow', 'leftWrist'];
      const sequence = [
        poseAt(165, 0, { preferredSide: 'left' }),
        poseAt(165, 500, { preferredSide: 'left' }),
        poseAt(140, 580, { preferredSide: 'right', missing: hiddenLeftArm }),
        poseAt(84, 700, { preferredSide: 'right', missing: hiddenLeftArm }),
        poseAt(112, 820, { preferredSide: 'right', missing: hiddenLeftArm }),
        poseAt(165, 1050, { preferredSide: 'right', missing: hiddenLeftArm }),
      ];
      const results = run(new PushupDetector(), sequence);
      expect(results.at(4)?.metrics.selectedSide).toBe('right');
      expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
      expect(results.at(-1)?.totalReps).toBe(1);
    });

    it('continues reliable arm motion through a brief selected-hip degradation', () => {
      const sequence = validRepSequence();
      sequence.splice(8, 0, poseAt(150, 1250, { missing: ['leftHip'] }));
      const results = run(new PushupDetector(), sequence);
      expect(results[8]?.metrics.contextState).toBe('UNCERTAIN');
      expect(results[8]?.metrics.armSignalReliable).toBe(true);
      expect(results.at(-1)?.totalReps).toBe(1);
    });

    it('explicitly rejects a completed cycle whose standard variant was never established', () => {
      const missingAnkles = ['leftAnkle', 'rightAnkle'];
      const sequence = [
        poseAt(165, 0),
        poseAt(165, 500),
        poseAt(165, 850, { missing: missingAnkles }),
        poseAt(165, 1200, { missing: missingAnkles }),
        poseAt(140, 1300, { missing: missingAnkles }),
        poseAt(84, 1420, { missing: missingAnkles }),
        poseAt(112, 1540, { missing: missingAnkles }),
        poseAt(165, 1750, { missing: missingAnkles }),
      ];
      const results = run(new PushupDetector(), sequence);
      expect(results.at(-1)?.rejectedReason).toBe('VARIANT_UNCONFIRMED');
      expect(results.at(-1)?.metrics.candidateEligibility).toBe('PENDING_STANDARD');
      expect(results.at(-1)?.totalReps).toBe(0);
    });
  });
});
