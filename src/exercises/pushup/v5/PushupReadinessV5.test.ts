import { describe, expect, it } from 'vitest';

import { poseAt } from '@/tests/poseFixtures';

import { PushupReadinessV5 } from './PushupReadinessV5';

interface SelectedSideConfidence {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
}

function poseWithSelectedSideConfidence(timestamp: number, confidence: SelectedSideConfidence) {
  return poseAt(166, timestamp, {
    landmarkConfidence: {
      leftShoulder: confidence.shoulder,
      leftElbow: confidence.elbow,
      leftWrist: confidence.wrist,
      leftHip: confidence.hip,
      leftKnee: confidence.knee,
      leftAnkle: confidence.ankle,
      rightShoulder: 0.05,
      rightElbow: 0.05,
      rightWrist: 0.05,
      rightHip: 0.05,
      rightKnee: 0.05,
      rightAnkle: 0.05,
    },
  });
}

function updateThroughHold(
  readiness: PushupReadinessV5,
  poseForTimestamp: (timestamp: number) => ReturnType<typeof poseAt>,
  end = 640,
) {
  let result = readiness.update(poseForTimestamp(0));
  for (let timestamp = 80; timestamp <= end; timestamp += 80) {
    result = readiness.update(poseForTimestamp(timestamp));
  }
  return result;
}

function scalePose(pose: ReturnType<typeof poseAt>, factor: number) {
  for (const landmark of Object.values(pose.landmarks)) {
    if (!landmark) continue;
    landmark.x = 0.5 + (landmark.x - 0.5) * factor;
    landmark.y = 0.5 + (landmark.y - 0.5) * factor;
  }
  return pose;
}

function settle(readiness: PushupReadinessV5, start = 0) {
  return [0, 80, 160, 240, 320, 400].map((offset) => readiness.update(poseAt(166, start + offset)));
}

describe('PushupReadinessV5', () => {
  it('uses canonical body span unchanged for a portrait camera', () => {
    const square = updateThroughHold(new PushupReadinessV5(), (timestamp) =>
      poseAt(166, timestamp),
    );
    const portrait = updateThroughHold(new PushupReadinessV5(), (timestamp) => ({
      ...poseAt(166, timestamp),
      sourceWidth: 1080,
      sourceHeight: 1920,
    }));
    expect(portrait.state).toBe(square.state);
    expect(portrait.poseQuality).toBe(square.poseQuality);
    expect(portrait.geometry?.shoulderHipDistance).toBe(square.geometry?.shoulderHipDistance);
  });
  it('requires temporal evidence, then reaches READY quickly', () => {
    const results = settle(new PushupReadinessV5());
    expect(results[0]?.state).toBe('POSITIONING');
    expect(results[0]?.reason).toBe('HOLD_STILL');
    expect(results.at(-1)?.state).toBe('READY');
    expect(results.at(-1)?.poseQuality).toBeGreaterThanOrEqual(72);
  });

  it('does not lose readiness for one bad wrist frame', () => {
    const readiness = new PushupReadinessV5();
    settle(readiness);
    const result = readiness.update(poseAt(166, 480, { landmarkConfidence: { leftWrist: 0.02 } }));
    expect(result.state).toBe('READY');
    expect(result.reason).toBeNull();
  });

  it('keeps local V5 ready through a sustained active-side visibility interruption', () => {
    const readiness = new PushupReadinessV5();
    settle(readiness);
    let result = readiness.update(poseAt(166, 480));
    for (let timestamp = 560; timestamp <= 1600; timestamp += 80) {
      result = readiness.update(
        poseAt(166, timestamp, { landmarkConfidence: { leftWrist: 0.02 } }),
      );
    }
    expect(result.state).toBe('READY');
  });

  it('rejects a standing pose as not being a pushup setup', () => {
    const readiness = new PushupReadinessV5();
    let result = readiness.update(poseAt(166, 0));
    for (let timestamp = 0; timestamp <= 600; timestamp += 80) {
      const pose = poseAt(166, timestamp);
      for (const landmark of Object.values(pose.landmarks)) {
        if (!landmark) continue;
        const x = landmark.x;
        const y = landmark.y;
        landmark.x = 0.5 - (y - 0.5);
        landmark.y = 0.5 + (x - 0.5);
      }
      result = readiness.update(pose);
    }
    expect(result.state).toBe('POSITIONING');
    expect(result.reason).toBe('GET_INTO_PUSHUP_POSITION');
  });

  it.each([
    ['too close', 1.35, 'MOVE_FARTHER_BACK'],
    ['too far', 0.2, 'MOVE_CLOSER'],
  ] as const)('reports when the person is %s', (_label, factor, reason) => {
    const readiness = new PushupReadinessV5();
    let result = readiness.update(scalePose(poseAt(166, 0), factor));
    for (let timestamp = 80; timestamp <= 480; timestamp += 80) {
      result = readiness.update(scalePose(poseAt(166, timestamp), factor));
    }
    expect(result.reason).toBe(reason);
  });

  it('allows a usable core and arm when lower-body landmarks are obscured', () => {
    const readiness = new PushupReadinessV5();
    let result = readiness.update(
      poseAt(166, 0, {
        landmarkConfidence: { leftKnee: 0.02, leftAnkle: 0.02 },
      }),
    );
    for (let timestamp = 80; timestamp <= 720; timestamp += 80) {
      result = readiness.update(
        poseAt(166, timestamp, {
          landmarkConfidence: { leftKnee: 0.02, leftAnkle: 0.02 },
        }),
      );
    }
    expect(result.state).toBe('READY');
    expect(result.reason).toBeNull();
  });

  it('keeps stability diagnostic-only for the lenient local V5 path', () => {
    const readiness = new PushupReadinessV5();
    let result = readiness.update(poseAt(166, 0));
    for (let timestamp = 80, index = 1; timestamp <= 720; timestamp += 80, index += 1) {
      const pose = poseAt(166, timestamp);
      const shift = index % 2 === 0 ? 0.08 : -0.08;
      for (const name of ['leftShoulder', 'leftHip'] as const) {
        const landmark = pose.landmarks[name];
        if (landmark) landmark.x += shift;
      }
      result = readiness.update(pose);
    }
    expect(result.state).toBe('READY');
  });

  it.each([20, 15, 10, 5])('treats the same smooth setup drift consistently at %i FPS', (fps) => {
    const readiness = new PushupReadinessV5();
    const interval = 1000 / fps;
    let result = readiness.update(poseAt(166, 0));
    for (let index = 1; ; index += 1) {
      const timestamp = Math.round(index * interval);
      if (timestamp > 600) break;
      const pose = poseAt(166, timestamp);
      const shift = timestamp * 0.00006;
      for (const landmark of Object.values(pose.landmarks)) {
        if (landmark) landmark.x += shift;
      }
      result = readiness.update(pose);
    }

    expect(result.state).toBe('READY');
    expect(result.reason).toBeNull();
    expect(result.stability).toBeGreaterThanOrEqual(0.7);
  });

  it('does not let a low-confidence ankle alone cause FULL BODY NOT VISIBLE', () => {
    const confidence = {
      shoulder: 0.84,
      elbow: 0.76,
      wrist: 0.79,
      hip: 0.75,
      knee: 0.67,
      ankle: 0.1,
    };
    const result = new PushupReadinessV5().update(poseWithSelectedSideConfidence(0, confidence));

    expect(result.supportingScore).toBeCloseTo(0.385);
    expect(result.reason).not.toBe('FULL_BODY_NOT_VISIBLE');
  });

  it('reaches READY with strong core and knee evidence when ankle confidence is variable', () => {
    const confidence = {
      shoulder: 0.77,
      elbow: 0.81,
      wrist: 0.75,
      hip: 0.75,
      knee: 0.67,
      ankle: 0.27,
    };
    const result = updateThroughHold(
      new PushupReadinessV5(),
      (timestamp) => poseWithSelectedSideConfidence(timestamp, confidence),
      480,
    );

    expect(result.state).toBe('READY');
    expect(result.reason).toBeNull();
  });

  it('does not require a side-on view when core, lower body, and plank geometry are valid', () => {
    const readiness = new PushupReadinessV5();
    const result = updateThroughHold(readiness, (timestamp) => {
      const pose = poseAt(166, timestamp);
      // A wide projected shoulder/hip separation models a diagonal or frontal
      // view. Selected-side geometry remains a valid horizontal plank.
      for (const name of ['rightShoulder', 'rightHip'] as const) {
        const landmark = pose.landmarks[name];
        if (landmark) landmark.x += 0.42;
      }
      return pose;
    });

    expect(result.state).toBe('READY');
    expect(result.reason).toBeNull();
  });

  it('still rejects a missing hip when the rest of the selected side is strong', () => {
    const confidence = {
      shoulder: 0.84,
      elbow: 0.76,
      wrist: 0.79,
      hip: 0.05,
      knee: 0.67,
      ankle: 0.27,
    };
    const result = updateThroughHold(new PushupReadinessV5(), (timestamp) =>
      poseWithSelectedSideConfidence(timestamp, confidence),
    );

    expect(result.state).toBe('POSITIONING');
    expect(result.reason).toBe('HIP_NOT_VISIBLE');
  });

  it('does not require sustained knee or ankle confidence for V5 readiness', () => {
    const confidence = {
      shoulder: 0.84,
      elbow: 0.76,
      wrist: 0.79,
      hip: 0.75,
      knee: 0.05,
      ankle: 0.05,
    };
    const result = updateThroughHold(new PushupReadinessV5(), (timestamp) =>
      poseWithSelectedSideConfidence(timestamp, confidence),
    );

    expect(result.state).toBe('READY');
    expect(result.reason).toBeNull();
  });

  it('reaches READY after a brief burst of normal settling jitter', () => {
    const readiness = new PushupReadinessV5();
    const result = updateThroughHold(
      readiness,
      (timestamp) => {
        const pose = poseAt(166, timestamp);
        if (timestamp === 80 || timestamp === 160) {
          const shift = timestamp === 80 ? 0.025 : -0.025;
          for (const name of ['leftShoulder', 'leftHip'] as const) {
            const landmark = pose.landmarks[name];
            if (landmark) landmark.x += shift;
          }
        }
        return pose;
      },
      800,
    );

    expect(result.state).toBe('READY');
    expect(result.reason).toBeNull();
  });

  it('keeps severe jitter diagnostic-only while core geometry remains plausible', () => {
    const readiness = new PushupReadinessV5();
    const result = updateThroughHold(readiness, (timestamp) => {
      const pose = poseAt(166, timestamp);
      const shift = (timestamp / 80) % 2 === 0 ? 0.08 : -0.08;
      for (const name of ['leftShoulder', 'leftHip'] as const) {
        const landmark = pose.landmarks[name];
        if (landmark) landmark.x += shift;
      }
      return pose;
    });

    expect(result.state).toBe('READY');
  });
});
