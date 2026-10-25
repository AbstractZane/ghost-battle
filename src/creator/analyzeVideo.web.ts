import { createGhostVideoEstimator } from './GhostVideoEstimator.web';
import { GhostAnalysisAccumulator } from './ghostAnalysis';
import { MAX_ANALYSIS_MS, type GhostAnalysisResult } from './ghostMotion';
import type { VideoRivalClip } from './videoRival';

/** Sequential seek/decode avoids sampling the same displayed frame repeatedly. */
export async function analyzeVideo(
  clip: VideoRivalClip,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<GhostAnalysisResult> {
  if (clip.durationMs < 1000 || clip.durationMs > MAX_ANALYSIS_MS)
    throw new Error(
      'Automatic analysis supports videos up to 5 minutes. Mark longer videos manually.',
    );
  signal.throwIfAborted();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  let model: Awaited<ReturnType<typeof createGhostVideoEstimator>> | null = null;
  const wait = (event: 'loadeddata' | 'seeked', action: () => void) =>
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener(event, done);
        video.removeEventListener('error', fail);
        signal.removeEventListener('abort', abort);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(
          new Error('This browser could not decode the video. Try another MP4 or manual marking.'),
        );
      };
      const abort = () => {
        cleanup();
        reject(new Error('Analysis cancelled.'));
      };
      const timeout = setTimeout(fail, 20000);
      video.addEventListener(event, done, { once: true });
      video.addEventListener('error', fail, { once: true });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else action();
    });
  try {
    await wait('loadeddata', () => {
      video.src = clip.uri;
      video.load();
    });
    try {
      model = await createGhostVideoEstimator();
    } catch {
      throw new Error(
        'The browser pose model could not load. Check WebGL and model access, or mark reps manually.',
      );
    }
    signal.throwIfAborted();
    const accumulator = new GhostAnalysisAccumulator(
      clip.durationMs,
      video.videoWidth / video.videoHeight,
    );
    for (let at = 0; at < clip.durationMs; at += 1000 / 15) {
      signal.throwIfAborted();
      const target = Math.min(at, clip.durationMs - 1) / 1000;
      if (Math.abs(video.currentTime - target) > 0.0001)
        await wait('seeked', () => {
          video.currentTime = target;
        });
      const actual = Math.round(video.currentTime * 1000);
      const pose = await model.estimate(video, actual + 1);
      signal.throwIfAborted();
      accumulator.add(pose, actual);
      onProgress(Math.min(1, at / clip.durationMs));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    onProgress(1);
    return accumulator.finish();
  } finally {
    model?.dispose();
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
