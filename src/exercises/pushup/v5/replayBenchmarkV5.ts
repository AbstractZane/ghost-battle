import type { PoseTrace } from '@/debug/poseTrace';
import { PushupDetector } from '@/exercises/pushup/PushupDetector';
import { PoseEngineV3 } from '@/pose/poseEngineV3';
import type { PoseResult } from '@/pose/poseTypes';

import { PushupDetectorV5 } from './PushupDetectorV5';
import type { PushupReplayFixtureV5 } from './v5Fixtures';

export interface DetectorComparisonRowV5 {
  fixture: string;
  expected: number;
  v4: number;
  v5: number;
}

type ReplayDetector = PushupDetector | PushupDetectorV5;

export function replayFramesV5(frames: ReadonlyArray<PoseResult>, detector: ReplayDetector) {
  const engine = new PoseEngineV3();
  const results = [];
  for (const pose of frames) {
    const pipelineFrame = engine.update(pose);
    if (!pipelineFrame) continue;
    results.push(
      detector.processPose(pipelineFrame.detectorPose, pipelineFrame.detectorPose.timestamp),
    );
  }
  return results;
}

export function countReplayRepsV5(
  frames: ReadonlyArray<PoseResult>,
  detector: ReplayDetector,
): number {
  return replayFramesV5(frames, detector).filter((result) => result.repCompleted).length;
}

export function comparePushupDetectorsV5(
  fixtures: ReadonlyArray<PushupReplayFixtureV5>,
): DetectorComparisonRowV5[] {
  return fixtures.map((fixture) => ({
    fixture: fixture.name,
    expected: fixture.expectedReps,
    v4: countReplayRepsV5(fixture.frames, new PushupDetector()),
    v5: countReplayRepsV5(fixture.frames, new PushupDetectorV5()),
  }));
}

export function comparePoseTraceV5(trace: PoseTrace): DetectorComparisonRowV5 {
  const frames = trace.frames.map((frame) => frame.rawPose);
  return {
    fixture: `pose trace ${trace.createdAt || 'unknown'}`,
    expected: Math.max(0, ...trace.frames.map((frame) => frame.detector.totalReps)),
    v4: countReplayRepsV5(frames, new PushupDetector()),
    v5: countReplayRepsV5(frames, new PushupDetectorV5()),
  };
}

export function formatDetectorComparisonV5(rows: ReadonlyArray<DetectorComparisonRowV5>): string {
  const heading =
    'Fixture'.padEnd(32) + 'Expected'.padStart(9) + 'V4'.padStart(5) + 'V5'.padStart(5);
  const divider = '-'.repeat(heading.length);
  return [
    heading,
    divider,
    ...rows.map(
      (row) =>
        row.fixture.slice(0, 32).padEnd(32) +
        String(row.expected).padStart(9) +
        String(row.v4).padStart(5) +
        String(row.v5).padStart(5),
    ),
  ].join('\n');
}
