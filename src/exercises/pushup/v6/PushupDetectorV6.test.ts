import { describe, expect, it } from 'vitest';

import { poseAt } from '@/tests/poseFixtures';

import { PushupDetectorV6 } from './PushupDetectorV6';
import { LAB_V6_FORM_RULES } from '../pushupRules';

function run(frames: ReturnType<typeof poseAt>[]) {
  const detector = new PushupDetectorV6();
  return frames.map((pose) => detector.processPose(pose, pose.timestamp));
}

function cycle(start = 0, preferredSide: 'left' | 'right' = 'left') {
  return (
    [
      [165, 0],
      [165, 180],
      [148, 280],
      [132, 380],
      [102, 500],
      [92, 600],
      [120, 720],
      [148, 850],
      [165, 960],
    ] as const
  ).map(([angle, offset]) => poseAt(angle, start + offset, { preferredSide }));
}

// Knee-evidence tests isolate that policy using the Form candidate's accepted
// depth, rather than failing earlier on its separately tested depth rule.
function formCycle() {
  return cycle().map((pose) => {
    const angle = pose.timestamp === 500 || pose.timestamp === 600 ? 80 : undefined;
    return angle === undefined ? pose : poseAt(angle, pose.timestamp);
  });
}

function upright(pose: ReturnType<typeof poseAt>) {
  const landmarks = { ...pose.landmarks };
  for (const side of ['left', 'right'] as const) {
    const shoulder = landmarks[`${side}Shoulder`]!;
    for (const joint of ['Shoulder', 'Elbow', 'Wrist'] as const) {
      const name = `${side}${joint}` as const;
      landmarks[name] = { ...landmarks[name]!, y: landmarks[name]!.y - 0.28 };
    }
    landmarks[`${side}Hip`] = { ...landmarks[`${side}Hip`]!, x: shoulder.x, y: 0.62 };
    landmarks[`${side}Knee`] = { ...landmarks[`${side}Knee`]!, x: shoulder.x, y: 0.79 };
    landmarks[`${side}Ankle`] = { ...landmarks[`${side}Ankle`]!, x: shoulder.x, y: 0.96 };
  }
  return { ...pose, landmarks, rawLandmarks: landmarks };
}

describe('PushupDetectorV6', () => {
  it('retains corroborated knee evidence through one brief missing-ankle frame in the Form lab profile', () => {
    // Synthetic confidence interruption, not a reconstruction of phone coordinates.
    const detector = new PushupDetectorV6({ ...LAB_V6_FORM_RULES });
    const frames = formCycle().map((pose, index) => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      const landmarks = {
        ...pose.landmarks,
        leftAnkle: { ...modified.landmarks.leftAnkle!, confidence: index === 5 ? 0.02 : 0.95 },
        rightAnkle: { ...modified.landmarks.rightAnkle!, confidence: index === 5 ? 0.02 : 0.65 },
      };
      return { ...pose, landmarks, rawLandmarks: landmarks };
    });
    const results = frames.map((pose) => detector.processPose(pose));
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
  });

  it.each(['expired gap', 'straight leg', 'isolated bend', 'unknown intervals'] as const)(
    'does not manufacture sustained knee evidence from %s',
    (kind) => {
      const detector = new PushupDetectorV6({ ...LAB_V6_FORM_RULES });
      const frames = formCycle().map((pose, index) => {
        const unknown =
          kind === 'expired gap'
            ? index === 5 || index === 6
            : kind === 'unknown intervals'
              ? index === 4 || index === 6
              : false;
        const bent =
          kind === 'isolated bend' ? index === 4 : kind === 'straight leg' ? index !== 5 : true;
        const support = poseAt(165, pose.timestamp, { kneeAngle: bent ? 90 : 180 });
        const landmarks = {
          ...pose.landmarks,
          leftAnkle: { ...support.landmarks.leftAnkle!, confidence: unknown ? 0.02 : 0.95 },
          rightAnkle: { ...support.landmarks.rightAnkle!, confidence: unknown ? 0.02 : 0.65 },
        };
        return { ...pose, landmarks, rawLandmarks: landmarks };
      });
      expect(frames.map((pose) => detector.processPose(pose)).at(-1)?.totalReps).toBe(1);
    },
  );

  it('rejects sustained upright arm cycles without changing arm readiness', () => {
    const results = run(cycle().map(upright));
    expect(results.some((result) => result.state === 'UP')).toBe(true);
    expect(results.some((result) => result.rejectedReason === 'BODY_ALIGNMENT')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('does not veto a rep for a single upright-looking tracking glitch', () => {
    const frames = cycle().map((pose, index) => (index === 4 ? upright(pose) : pose));
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('keeps upright posture unknown when the hip is not reliable', () => {
    const frames = cycle().map((pose) => {
      const standing = upright(pose);
      standing.landmarks.leftHip!.confidence = 0.02;
      standing.landmarks.rightHip!.confidence = 0.02;
      return standing;
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('does not confuse a vertically projected front-view torso with standing', () => {
    const frames = cycle().map((pose) => {
      const landmarks = {
        ...pose.landmarks,
        leftHip: { ...pose.landmarks.leftHip!, x: pose.landmarks.leftShoulder!.x, y: 0.08 },
        rightHip: { ...pose.landmarks.rightHip!, x: pose.landmarks.rightShoulder!.x, y: 0.08 },
      };
      return { ...pose, landmarks, rawLandmarks: landmarks };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('recognizes sustained bent knees with strong hips/knees and a supporting 0.30 ankle', () => {
    // Confidence pattern is based on the mixed phone log, geometry is synthetic.
    const frames = cycle().map((pose) => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      const landmarks = {
        ...pose.landmarks,
        leftAnkle: { ...modified.landmarks.leftAnkle!, confidence: 0.3 },
        rightAnkle: { ...modified.landmarks.rightAnkle!, confidence: 0.3 },
      };
      return { ...pose, landmarks, rawLandmarks: landmarks };
    });
    const results = run(frames);
    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('keeps full reps with weak but straight ankles countable', () => {
    const frames = cycle().map((pose) => {
      const landmarks = {
        ...pose.landmarks,
        leftAnkle: { ...pose.landmarks.leftAnkle!, confidence: 0.3 },
        rightAnkle: { ...pose.landmarks.rightAnkle!, confidence: 0.3 },
      };
      return { ...pose, landmarks, rawLandmarks: landmarks };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('does not trust a supporting ankle collapsed onto the knee', () => {
    const frames = cycle().map((pose) => {
      const landmarks = {
        ...pose.landmarks,
        leftAnkle: {
          ...pose.landmarks.leftKnee!,
          y: pose.landmarks.leftKnee!.y + 0.005,
          confidence: 0.3,
        },
        rightAnkle: {
          ...pose.landmarks.rightKnee!,
          y: pose.landmarks.rightKnee!.y + 0.005,
          confidence: 0.3,
        },
      };
      return { ...pose, landmarks, rawLandmarks: landmarks };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('does not use stale or predicted ankles as knee-support evidence', () => {
    const frames = cycle().map((pose): ReturnType<typeof poseAt> => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      const landmarks = {
        ...pose.landmarks,
        leftAnkle: modified.landmarks.leftAnkle,
        rightAnkle: modified.landmarks.rightAnkle,
      };
      return {
        ...pose,
        landmarks,
        tracking: {
          signalQuality: 'GOOD' as const,
          lastReliableTimestamp: pose.timestamp,
          freshLandmarks: ['leftHip', 'leftKnee', 'rightHip', 'rightKnee'],
          predictedLandmarks: ['leftAnkle', 'rightAnkle'],
        },
      };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('does not turn a weak raw ankle into strong evidence through smoothing', () => {
    const frames = cycle().map((pose) => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      const landmarks = {
        ...pose.landmarks,
        leftAnkle: modified.landmarks.leftAnkle,
        rightAnkle: modified.landmarks.rightAnkle,
      };
      return {
        ...pose,
        landmarks,
        rawLandmarks: {
          ...landmarks,
          leftAnkle: { ...landmarks.leftAnkle!, confidence: 0.1 },
          rightAnkle: { ...landmarks.rightAnkle!, confidence: 0.1 },
        },
      };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });
  it('counts a sparse YOLO cycle when an intermediate descent/ascent frame is not sampled', () => {
    // Phone evidence: roughly 8 pose updates/s with occasional 250-376 ms gaps.
    // This is a kinematic regression fixture, not a replay of unrecorded phone landmarks.
    const frames = [
      [159, 0],
      [159, 200],
      [140, 325],
      [84, 450],
      [157, 825],
    ].map(([angle, timestamp]) => poseAt(angle!, timestamp!));
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('still rejects a one-frame fast bottom spike at sparse cadence', () => {
    const frames = [
      [159, 0],
      [159, 200],
      [84, 325],
      [157, 450],
    ].map(([angle, timestamp]) => poseAt(angle!, timestamp!));
    expect(run(frames).at(-1)?.totalReps).toBe(0);
  });

  it('never stitches a rep across a gap longer than the tracking grace', () => {
    const frames = [
      [165, 0],
      [165, 200],
      [132, 325],
      [92, 450],
      [120, 575],
      [165, 1576],
    ].map(([angle, timestamp]) => poseAt(angle!, timestamp!));
    expect(run(frames).at(-1)?.totalReps).toBe(0);
  });

  it('counts a complete side-view arm cycle with no lower-body requirement', () => {
    const frames = cycle().map((pose) => ({
      ...pose,
      landmarks: {
        ...pose.landmarks,
        leftHip: { ...pose.landmarks.leftHip!, confidence: 0.02 },
        leftKnee: { ...pose.landmarks.leftKnee!, confidence: 0.02 },
        leftAnkle: { ...pose.landmarks.leftAnkle!, confidence: 0.02 },
      },
    }));
    const results = run(frames);
    expect(results.filter((result) => result.repCompleted)).toHaveLength(1);
    expect(results.at(-1)?.metrics.bodyAlignmentSource).toBe('unavailable');
  });

  it('fuses front-facing arms instead of making the user choose a side', () => {
    const frames = cycle().map((pose) => ({
      ...pose,
      landmarks: {
        ...pose.landmarks,
        rightShoulder: { ...pose.landmarks.leftShoulder! },
        rightElbow: { ...pose.landmarks.leftElbow! },
        rightWrist: { ...pose.landmarks.leftWrist! },
      },
    }));
    const results = run(frames);
    expect(results.some((result) => result.metrics.elbowSource === 'fused')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('uses the other arm when the primary arm briefly drops out', () => {
    const frames = cycle().map((pose, index) =>
      index === 4
        ? {
            ...pose,
            landmarks: {
              ...pose.landmarks,
              leftShoulder: { ...pose.landmarks.leftShoulder!, confidence: 0.02 },
              leftElbow: { ...pose.landmarks.leftElbow!, confidence: 0.02 },
              leftWrist: { ...pose.landmarks.leftWrist!, confidence: 0.02 },
            },
          }
        : pose,
    );
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('does not count a shallow arm bend', () => {
    const frames = [165, 165, 148, 135, 120, 132, 148, 165].map((angle, index) =>
      poseAt(angle, index * 140),
    );
    expect(run(frames).at(-1)?.totalReps).toBe(0);
  });

  it('rejects a repeated marginal half-rep bend while keeping readiness', () => {
    const frames = [165, 165, 132, 105, 105, 120, 148, 165].map((angle, index) =>
      poseAt(angle, index * 180),
    );
    const results = run(frames);
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.at(-1)?.state).toBe('UP');
  });

  it('rejects an isolated marginal bottom reading during a quarter-rep cycle', () => {
    // A kinematic noise fixture, not recorded landmarks from the user's phone.
    const frames = [165, 165, 132, 96, 132, 148, 165].map((angle, index) =>
      poseAt(angle, index * 180),
    );
    const results = run(frames);
    expect(results.at(-1)?.totalReps).toBe(0);
    expect(results.some((result) => result.rejectedReason === 'INSUFFICIENT_DEPTH')).toBe(true);
  });

  it('counts a moderate full-depth cycle with corroborating bottom observations', () => {
    const frames = [165, 165, 132, 106, 98, 106, 120, 148, 165].map((angle, index) =>
      poseAt(angle, index * 180),
    );
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('does not join separate shallow bends to corroborate an earlier noisy bottom', () => {
    const frames = [165, 165, 132, 96, 132, 106, 106, 132, 165].map((angle, index) =>
      poseAt(angle, index * 180),
    );
    expect(run(frames).at(-1)?.totalReps).toBe(0);
  });

  it('does not confirm marginal bottom depth across a frame with no reliable arms', () => {
    const frames = [165, 165, 132, 98, 98, 98, 132, 165].map((angle, index) =>
      poseAt(angle, index * 180, index === 4 ? { confidence: 0.02 } : {}),
    );
    expect(run(frames).at(-1)?.totalReps).toBe(0);
  });

  it('remembers confirmed knees-down evidence when the ankles disappear at lockout', () => {
    const frames = cycle().map((pose, index) => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      return {
        ...pose,
        landmarks: {
          ...pose.landmarks,
          leftAnkle: {
            ...modified.landmarks.leftAnkle!,
            confidence: index >= 7 ? 0.02 : 0.95,
          },
          rightAnkle: {
            ...modified.landmarks.rightAnkle!,
            confidence: index >= 7 ? 0.02 : 0.65,
          },
        },
      };
    });
    const results = run(frames);
    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('uses reliable knees-down evidence on the side opposite the strongest arm', () => {
    const frames = cycle().map((pose) => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      return {
        ...pose,
        landmarks: {
          ...pose.landmarks,
          leftHip: { ...pose.landmarks.leftHip!, confidence: 0.02 },
          leftKnee: { ...pose.landmarks.leftKnee!, confidence: 0.02 },
          leftAnkle: { ...pose.landmarks.leftAnkle!, confidence: 0.02 },
          rightAnkle: { ...modified.landmarks.rightAnkle!, confidence: 0.5 },
        },
      };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(0);
  });

  it('keeps ambiguous or briefly bent legs from vetoing a complete rep', () => {
    const frames = cycle().map((pose, index) => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      return {
        ...pose,
        landmarks: {
          ...pose.landmarks,
          leftAnkle: index === 4 ? modified.landmarks.leftAnkle : pose.landmarks.leftAnkle,
        },
      };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('keeps sustained disagreement between projected leg chains neutral', () => {
    const frames = cycle().map((pose) => {
      const modified = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      return {
        ...pose,
        landmarks: { ...pose.landmarks, leftAnkle: modified.landmarks.leftAnkle },
      };
    });
    expect(run(frames).at(-1)?.totalReps).toBe(1);
  });

  it('allows a standard rep after rejecting a knees-down candidate', () => {
    const modified = cycle().map((pose) => {
      const knees = poseAt(165, pose.timestamp, { kneeAngle: 90 });
      return {
        ...pose,
        landmarks: {
          ...pose.landmarks,
          leftAnkle: knees.landmarks.leftAnkle,
          rightAnkle: knees.landmarks.rightAnkle,
        },
      };
    });
    const results = run([...modified, ...cycle(1080)]);
    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(1);
  });

  it('does not count when the person starts below the top position', () => {
    const frames = [125, 100, 92, 120, 145].map((angle, index) => poseAt(angle, index * 160));
    expect(run(frames).at(-1)?.totalReps).toBe(0);
  });

  it('vetoes only sustained, high-confidence knees-down evidence at count time', () => {
    const frames = [
      [165, 0],
      [165, 180],
      [148, 280],
      [132, 380],
      [102, 500],
      [92, 600],
      [120, 720],
      [148, 850],
      [165, 960],
    ].map(([angle, timestamp]) => poseAt(angle ?? 165, timestamp ?? 0, { kneeAngle: 90 }));
    const results = run(frames);

    expect(results.some((result) => result.rejectedReason === 'MODIFIED_PUSHUP')).toBe(true);
    expect(results.at(-1)?.totalReps).toBe(0);
  });

  it('counts consecutive full cycles exactly once each', () => {
    const results = run([...cycle(), ...cycle(1_080)]);
    expect(results.filter((result) => result.repCompleted)).toHaveLength(2);
    expect(results.at(-1)?.totalReps).toBe(2);
  });

  it('retains completed candidate evidence for diagnostics until reset', () => {
    const detector = new PushupDetectorV6();
    const results = cycle().map((pose) => detector.processPose(pose));
    const completed = results.find((result) => result.repCompleted);
    expect(completed?.rep).toBeDefined();
    expect(detector.getPostureDiagnostics()).toMatchObject({
      scope: 'completed-candidate',
      completedAt: completed!.rep!.timestamp,
      bottomConfirmed: true,
    });
    detector.reset();
    expect(detector.getPostureDiagnostics()).toMatchObject({
      scope: 'none',
      completedAt: null,
      bottomConfirmed: false,
      modifiedEvidenceMs: 0,
    });
  });
});
