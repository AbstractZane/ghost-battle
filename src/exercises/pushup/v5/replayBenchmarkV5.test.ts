import { describe, expect, it } from 'vitest';

import { PoseTraceRecorder } from '@/debug/poseTrace';
import { PushupDetector } from '@/exercises/pushup/PushupDetector';
import { PoseEngineV3 } from '@/pose/poseEngineV3';

import {
  comparePoseTraceV5,
  comparePushupDetectorsV5,
  formatDetectorComparisonV5,
} from './replayBenchmarkV5';
import { pushupReplayFixturesV5, validPushupsV5 } from './v5Fixtures';

describe('V4 versus V5 replay benchmark', () => {
  it('runs every deterministic fixture through the same raw-pose pipeline', () => {
    const fixtures = pushupReplayFixturesV5();
    const rows = comparePushupDetectorsV5(fixtures);
    console.info(formatDetectorComparisonV5(rows));
    expect(rows).toHaveLength(fixtures.length);
    expect(rows.every((row) => row.v5 === row.expected)).toBe(true);
    expect(formatDetectorComparisonV5(rows)).toContain('Expected   V4   V5');
  });

  it('replays a recorded landmark-only trace through both detector versions', () => {
    const recorder = new PoseTraceRecorder();
    const engine = new PoseEngineV3();
    const detector = new PushupDetector();
    recorder.start(new Date('2026-09-01T00:00:00.000Z'), 'movenet-lightning', {
      platform: 'web',
      detectorVersion: 'v4',
    });
    for (const pose of validPushupsV5(1)) {
      const frame = engine.update(pose);
      if (frame) recorder.record(frame, detector.processPose(frame.detectorPose));
    }
    expect(comparePoseTraceV5(recorder.stop())).toMatchObject({ expected: 1, v4: 1, v5: 1 });
  });
});
