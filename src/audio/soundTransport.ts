import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { configurePlaybackSession } from './audioSession';
import { soundSources } from './soundSources';
import type { SoundCue, SoundLane, SoundTransport } from './SoundEffectsEngine';

export async function createSoundTransport(): Promise<SoundTransport> {
  if (Platform.OS === 'web') {
    const context = new AudioContext();
    const buffers = new Map<SoundCue, AudioBuffer>();
    const voices: Partial<Record<SoundLane, AudioBufferSourceNode>> = {};
    let disposed = false;
    // Decode ahead of time. A missing clip drops that cue instead of delaying an event.
    void Promise.allSettled(
      (Object.keys(soundSources) as SoundCue[]).map(async (cue) => {
        const response = await fetch(Asset.fromModule(soundSources[cue]).uri);
        if (!response.ok) return;
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!disposed) buffers.set(cue, buffer);
      }),
    );
    const stop = (lane?: SoundLane) => {
      for (const name of lane ? [lane] : (['ui', 'event'] as const)) {
        const voice = voices[name];
        if (voice) {
          try {
            voice.stop();
          } catch {
            /* Already ended. */
          }
          voice.disconnect();
        }
        delete voices[name];
      }
    };
    return {
      unlock() {
        if (!disposed && context.state === 'suspended')
          void context.resume().catch(() => undefined);
      },
      play(cue, volume, lane) {
        if (disposed || context.state !== 'running' || !buffers.has(cue)) return;
        stop(lane);
        const voice = context.createBufferSource();
        const gain = context.createGain();
        voice.buffer = buffers.get(cue)!;
        gain.gain.value = volume;
        voice.connect(gain);
        gain.connect(context.destination);
        voices[lane] = voice;
        voice.onended = () => {
          voice.disconnect();
          gain.disconnect();
          if (voices[lane] === voice) delete voices[lane];
        };
        voice.start();
      },
      stop,
      dispose() {
        disposed = true;
        stop();
        buffers.clear();
        void context.close().catch(() => undefined);
      },
    };
  }
  const { createAudioPlayer, preload, clearPreloadedSource } = await import('expo-audio');
  await configurePlaybackSession();
  await Promise.allSettled(Object.values(soundSources).map((source) => preload(source)));
  const voices = {
    ui: createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: false }),
    event: createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: false }),
  };
  let disposed = false;
  const stop = (lane?: SoundLane) => {
    if (disposed) return;
    for (const name of lane ? [lane] : (['ui', 'event'] as const)) {
      try {
        voices[name].pause();
        voices[name].replace(null);
      } catch {
        /* A released or interrupted player must not block mute/navigation. */
      }
    }
  };
  return {
    unlock() {},
    play(cue, volume, lane) {
      if (disposed) return;
      try {
        stop(lane);
        voices[lane].volume = volume;
        voices[lane].replace(soundSources[cue]);
        voices[lane].play();
      } catch {
        /* An interrupted/missing native player must never block an action. */
      }
    },
    stop,
    dispose() {
      stop();
      disposed = true;
      for (const player of Object.values(voices)) {
        try {
          player.release();
        } catch {
          /* Native teardown can race an interruption. */
        }
      }
      for (const source of Object.values(soundSources))
        void clearPreloadedSource(source).catch(() => undefined);
    },
  };
}
