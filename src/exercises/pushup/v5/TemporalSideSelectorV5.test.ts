import { describe, expect, it } from 'vitest';

import { DEFAULT_PUSHUP_RULES } from '@/exercises/pushup/pushupRules';
import { poseAt } from '@/tests/poseFixtures';

import { TemporalSideSelectorV5 } from './TemporalSideSelectorV5';

describe('TemporalSideSelectorV5', () => {
  it('does not switch for a brief alternate-side confidence advantage', () => {
    const selector = new TemporalSideSelectorV5({ ...DEFAULT_PUSHUP_RULES });
    expect(selector.update(poseAt(166, 0).landmarks, 0).side).toBe('left');
    const brief = poseAt(166, 800, { preferredSide: 'right' });
    expect(selector.update(brief.landmarks, 800).side).toBe('left');
    expect(selector.update(poseAt(166, 880).landmarks, 880).side).toBe('left');
  });

  it('switches only after a meaningful sustained advantage', () => {
    const selector = new TemporalSideSelectorV5({ ...DEFAULT_PUSHUP_RULES });
    selector.update(poseAt(166, 0).landmarks, 0);
    let selected = selector.update(poseAt(166, 800, { preferredSide: 'right' }).landmarks, 800);
    for (let timestamp = 900; timestamp <= 1800; timestamp += 100) {
      selected = selector.update(
        poseAt(166, timestamp, { preferredSide: 'right' }).landmarks,
        timestamp,
      );
    }
    expect(selected.side).toBe('right');
    expect(selected.changed).toBe(false);
  });

  it('uses sustained emergency failover when the active side becomes unusable', () => {
    const selector = new TemporalSideSelectorV5({ ...DEFAULT_PUSHUP_RULES });
    selector.update(poseAt(166, 0).landmarks, 0);
    let selected = selector.update(
      poseAt(166, 100, {
        preferredSide: 'right',
        landmarkConfidence: {
          leftShoulder: 0.02,
          leftElbow: 0.02,
          leftHip: 0.02,
        },
      }).landmarks,
      100,
    );
    for (let timestamp = 200; timestamp <= 500; timestamp += 100) {
      selected = selector.update(
        poseAt(166, timestamp, {
          preferredSide: 'right',
          landmarkConfidence: {
            leftShoulder: 0.02,
            leftElbow: 0.02,
            leftHip: 0.02,
          },
        }).landmarks,
        timestamp,
      );
    }
    expect(selected.side).toBe('right');
  });
});
