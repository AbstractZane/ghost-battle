import { NativeModules, Platform } from 'react-native';
import { YoloPoseAdapter, parseYoloPoseSample } from '@/pose/yoloPoseAdapter';
import { GhostAnalysisAccumulator } from './ghostAnalysis';
import { MAX_ANALYSIS_MS, type GhostAnalysisResult } from './ghostMotion';
import type { VideoRivalClip } from './videoRival';

interface VideoAnalysisBridge {
  start(uri: string, durationMs: number): Promise<string>;
  poll(id: string): Promise<string>;
  cancel(id: string): void;
}
interface NativeBatch {
  state: string;
  samples: string[];
  progress: number;
  aspectRatio: number;
  error?: string;
}
export async function analyzeVideo(
  clip: VideoRivalClip,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<GhostAnalysisResult> {
  if (clip.durationMs < 1000 || clip.durationMs > MAX_ANALYSIS_MS)
    throw new Error(
      'Automatic analysis supports videos up to 5 minutes. You can still mark longer videos manually.',
    );
  const bridge = NativeModules.GhostVideoAnalysis as VideoAnalysisBridge | undefined;
  if (Platform.OS !== 'android' || !bridge)
    throw new Error(
      'Video analysis requires the updated Android build. Manual marking is still available.',
    );
  signal.throwIfAborted();
  const id = await bridge.start(clip.uri, clip.durationMs);
  const adapter = new YoloPoseAdapter();
  let accumulator: GhostAnalysisAccumulator | null = null;
  const cancel = () => bridge.cancel(id);
  signal.addEventListener('abort', cancel);
  try {
    while (true) {
      signal.throwIfAborted();
      const batch = JSON.parse(await bridge.poll(id)) as NativeBatch;
      signal.throwIfAborted();
      if (batch.state === 'error')
        throw new Error(batch.error ?? 'The video could not be analyzed. Try manual markers.');
      if (batch.state === 'cancelled') throw new Error('Analysis cancelled.');
      if (!accumulator && batch.aspectRatio > 0)
        accumulator = new GhostAnalysisAccumulator(clip.durationMs, batch.aspectRatio);
      for (const raw of batch.samples) {
        signal.throwIfAborted();
        const sample = parseYoloPoseSample(raw);
        if (sample && typeof sample === 'object') {
          const result = adapter.process(sample, 'back', false);
          accumulator?.add(result.kind === 'pose' ? result.pose : null, sample.capturedAt - 1);
        } else if (sample === 'absent') {
          const missing = JSON.parse(raw) as { capturedAt: number };
          accumulator?.add(null, missing.capturedAt - 1);
        }
      }
      onProgress(Math.max(0, Math.min(1, batch.progress)));
      if (batch.state === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const result = accumulator?.finish();
    if (!result?.motion.frames.length)
      throw new Error(
        'No usable video frames were found. Try a different clip or mark reps manually.',
      );
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    bridge.cancel(id);
  }
}
