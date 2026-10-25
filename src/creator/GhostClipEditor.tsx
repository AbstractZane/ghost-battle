import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ValueSlider } from '@/components/ValueSlider';
import { SoundPressable } from '@/components/SoundPressable';
import { videoRivalScore, type VideoRivalClip } from './videoRival';
import { addGhostMarker } from './ghostChallenges';
import { analyzeVideo } from './analyzeVideo';
import { GhostMotionView } from './GhostMotionView';
import { MAX_ANALYSIS_MS } from './ghostMotion';

export function GhostClipEditor({
  clip,
  disabled,
  onChange,
  onError,
  onAnalysisBusy,
}: {
  clip: VideoRivalClip;
  disabled: boolean;
  onChange(clip: VideoRivalClip): void;
  onError(error: string | null): void;
  onAnalysisBusy?(busy: boolean): void;
}) {
  const focused = useIsFocused();
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const undo = useRef<number[][]>([]);
  const [analysis, setAnalysis] = useState<number | null>(null);
  const [vision, setVision] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  const analyze = async () => {
    if (analysis !== null || disabled) return;
    player.pause();
    const controller = new AbortController();
    abort.current = controller;
    setAnalysis(0);
    onAnalysisBusy?.(true);
    onError(null);
    try {
      const result = await analyzeVideo(clip, controller.signal, (value) => {
        if (!controller.signal.aborted) setAnalysis(value);
      });
      if (controller.signal.aborted) return;
      undo.current.push([...clip.repTimesMs]);
      onChange({
        ...clip,
        version: 2,
        motion: result.motion,
        repTimesMs: result.repTimesMs,
        gaps: result.gaps,
        analysisReviewed: false,
        marking: 'detector',
      });
      setVision(false);
      if (!result.repTimesMs.length)
        onError('No complete reps were detected. Inspect tracking gaps and add markers manually.');
    } catch (cause) {
      if (!controller.signal.aborted)
        onError(
          cause instanceof Error ? cause.message : 'Analysis failed. Manual marking is available.',
        );
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setAnalysis(null);
        onAnalysisBusy?.(false);
      }
    }
  };
  const player = useVideoPlayer(clip.uri, (video) => {
    video.muted = true;
    video.audioMixingMode = 'mixWithOthers';
    video.loop = false;
    video.timeUpdateEventInterval = 0.05;
    video.staysActiveInBackground = false;
  });
  useEffect(() => {
    const time = player.addListener('timeUpdate', ({ currentTime }) =>
      setPosition(Math.round(currentTime * 1000)),
    );
    const playingSub = player.addListener('playingChange', ({ isPlaying }) =>
      setPlaying(isPlaying),
    );
    const error = player.addListener('statusChange', ({ status }) => {
      if (status === 'error')
        onError('This video cannot play. Try a local MP4 with a supported codec.');
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        player.pause();
        abort.current?.abort();
      }
    });
    return () => {
      time.remove();
      playingSub.remove();
      error.remove();
      app.remove();
    };
  }, [onError, player]);
  useEffect(() => {
    const update = (seconds: number) => {
      const durationMs = Math.round(seconds * 1000);
      if (durationMs >= 1000 && durationMs <= 1_800_000 && durationMs !== clip.durationMs)
        onChange({
          ...clip,
          durationMs,
          repTimesMs: clip.repTimesMs.filter((at) => at <= durationMs),
        });
      else if (durationMs > 1_800_000) onError('Choose a video no longer than 30 minutes.');
    };
    if (player.duration > 0) update(player.duration);
    const sub = player.addListener('sourceLoad', ({ duration }) => update(duration));
    // SDK 57's web player reports readiness but does not emit sourceLoad.
    const ready = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') update(player.duration);
    });
    return () => {
      sub.remove();
      ready.remove();
    };
  }, [clip, onChange, onError, player]);
  // Expo owns unmount release. A later cleanup must never pause a released player.
  useEffect(() => {
    if (!focused || disabled) player.pause();
  }, [disabled, focused, player]);
  const seek = (at: number) => {
    player.pause();
    player.currentTime = at / 1000;
    setPosition(at);
  };
  const edit = (next: number[]) => {
    undo.current.push([...clip.repTimesMs]);
    onChange({ ...clip, repTimesMs: next, marking: 'edited', analysisReviewed: false });
    onError(null);
  };
  const mark = () => {
    if (disabled) return;
    const next = addGhostMarker(clip.repTimesMs, player.currentTime * 1000, clip.durationMs);
    if (next.length !== clip.repTimesMs.length) edit(next);
  };
  const selected = videoRivalScore(clip.repTimesMs, position) - 1;
  const duration = Math.max(1, clip.durationMs);
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Text style={styles.label}>MARK COMPLETED PUSH-UPS</Text>
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {clip.repTimesMs.length} REPS
        </Text>
      </View>
      <View style={styles.row}>
        <PrimaryButton
          compact
          label={
            analysis === null
              ? clip.motion
                ? 'RE-ANALYZE'
                : 'AUTO-FIND REPS'
              : `ANALYZING ${Math.round(analysis * 100)}% · CANCEL`
          }
          variant="secondary"
          style={styles.tool}
          disabled={
            disabled ||
            (!clip.durationMs && analysis === null) ||
            (clip.durationMs > MAX_ANALYSIS_MS && analysis === null)
          }
          onPress={() => {
            if (analysis !== null) abort.current?.abort();
            else void analyze();
          }}
        />
        {clip.motion ? (
          <PrimaryButton
            compact
            label={vision ? 'SHOW VIDEO' : 'GHOST VISION'}
            variant="quiet"
            disabled={analysis !== null}
            onPress={() => setVision(!vision)}
          />
        ) : null}
      </View>
      <View style={styles.video}>
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, styles.videoSurface]}
          contentFit="contain"
          surfaceType="textureView"
          nativeControls={false}
          allowsPictureInPicture={false}
          fullscreenOptions={{ enable: false }}
        />
        {vision && clip.motion ? <GhostMotionView track={clip.motion} atMs={position} /> : null}
        <View pointerEvents="none" style={styles.counter}>
          <Text style={styles.counterText}>{videoRivalScore(clip.repTimesMs, position)}</Text>
          <Text style={styles.counterLabel}>GHOST REPS</Text>
        </View>
      </View>
      <View pointerEvents="none" style={styles.rail}>
        {clip.gaps?.map((gap) => (
          <View
            key={`${gap.fromMs}:${gap.toMs}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${(gap.fromMs / duration) * 100}%`,
              width: `${((gap.toMs - gap.fromMs) / duration) * 100}%`,
              backgroundColor: '#C57742',
            }}
          />
        ))}
        {clip.repTimesMs
          .filter((_, i) => i % Math.max(1, Math.ceil(clip.repTimesMs.length / 120)) === 0)
          .map((time) => (
            <View key={time} style={[styles.marker, { left: `${(time / duration) * 100}%` }]} />
          ))}
        <View
          style={[styles.cursor, { left: `${(Math.min(position, duration) / duration) * 100}%` }]}
        />
      </View>
      <ValueSlider
        label="Video position"
        min={0}
        max={duration}
        step={100}
        value={Math.min(position, duration)}
        valueText={`${(position / 1000).toFixed(1)} seconds`}
        disabled={disabled || analysis !== null || !clip.durationMs}
        onChange={seek}
      />
      <View style={styles.tools}>
        <PrimaryButton
          compact
          label={playing ? 'PAUSE' : 'PLAY'}
          variant="secondary"
          style={styles.tool}
          disabled={disabled || analysis !== null || !clip.durationMs}
          onPress={() => {
            if (playing) player.pause();
            else {
              if (position >= clip.durationMs - 100) player.currentTime = 0;
              player.play();
            }
          }}
        />
        <PrimaryButton
          compact
          label="MARK +1"
          style={styles.tool}
          disabled={disabled || analysis !== null || !clip.durationMs}
          onPress={mark}
        />
        <PrimaryButton
          compact
          label="UNDO"
          variant="quiet"
          style={styles.tool}
          disabled={disabled || analysis !== null || !undo.current.length}
          onPress={() =>
            onChange({
              ...clip,
              repTimesMs: undo.current.pop() ?? clip.repTimesMs,
              marking: 'edited',
              analysisReviewed: false,
            })
          }
        />
      </View>
      <View style={styles.row}>
        <SoundPressable
          accessibilityRole="button"
          accessibilityLabel="Previous rep marker"
          disabled={disabled || analysis !== null || selected < 0}
          onPress={() => seek(clip.repTimesMs[Math.max(0, selected - 1)] ?? 0)}
          style={styles.markerButton}
        >
          <Text style={styles.arrow}>‹</Text>
        </SoundPressable>
        <Text numberOfLines={1} style={styles.selected}>
          {selected >= 0
            ? `Rep ${selected + 1} · ${(clip.repTimesMs[selected]! / 1000).toFixed(1)}s`
            : 'Scrub to inspect markers'}
        </Text>
        <SoundPressable
          accessibilityRole="button"
          accessibilityLabel="Next rep marker"
          disabled={disabled || analysis !== null || selected + 1 >= clip.repTimesMs.length}
          onPress={() => seek(clip.repTimesMs[selected + 1] ?? 0)}
          style={styles.markerButton}
        >
          <Text style={styles.arrow}>›</Text>
        </SoundPressable>
        <SoundPressable
          accessibilityRole="button"
          accessibilityLabel="Remove selected rep marker"
          disabled={disabled || analysis !== null || selected < 0}
          onPress={() => edit(clip.repTimesMs.filter((_, i) => i !== selected))}
          style={styles.markerButton}
        >
          <Text style={styles.remove}>REMOVE</Text>
        </SoundPressable>
      </View>
      {clip.motion ? (
        <SoundPressable
          accessibilityRole="checkbox"
          aria-checked={clip.analysisReviewed === true}
          accessibilityState={{ checked: clip.analysisReviewed === true }}
          disabled={disabled || analysis !== null}
          style={styles.review}
          onPress={() => onChange({ ...clip, analysisReviewed: !clip.analysisReviewed })}
        >
          <Text style={styles.hint}>
            {clip.analysisReviewed ? '☑' : '☐'} I checked the markers. Save body motion with this
            ghost.
          </Text>
        </SoundPressable>
      ) : (
        <Text style={styles.hint}>
          Mark once at each completed rep. Auto analysis: up to 5 minutes. Orange marks tracking
          gaps.
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  review: { minHeight: 44, justifyContent: 'center' },
  videoSurface: { width: '100%', height: '100%' },
  root: { flex: 1, minHeight: 0, gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { color: '#96A6BC', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  count: { color: '#CFF9A5', fontSize: 10, fontWeight: '900', marginLeft: 'auto' },
  video: {
    flex: 1,
    minHeight: 100,
    backgroundColor: '#020407',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3C3553',
  },
  counter: {
    position: 'absolute',
    right: 10,
    top: 10,
    padding: 9,
    borderRadius: 12,
    backgroundColor: '#0B101BD9',
    alignItems: 'center',
  },
  counterText: { fontSize: 29, fontWeight: '900', color: '#D5FCA8' },
  counterLabel: { fontSize: 7, letterSpacing: 0.5, color: '#94A4BB' },
  rail: {
    height: 8,
    backgroundColor: '#202638',
    borderRadius: 3,
    overflow: 'hidden',
    marginHorizontal: 3,
  },
  marker: { position: 'absolute', width: 2, top: 2, bottom: 2, backgroundColor: '#B397EC' },
  cursor: { position: 'absolute', width: 2, top: 0, bottom: 0, backgroundColor: '#D5FFA2' },
  tools: { flexDirection: 'row', gap: 6 },
  tool: { flex: 1, minWidth: 0 },
  markerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  arrow: { fontSize: 22, color: '#BAC7DB' },
  selected: { flex: 1, color: '#A6B5CA', fontSize: 10 },
  remove: { color: '#E2A6B8', fontSize: 9, fontWeight: '800' },
  hint: { color: '#8D9FB7', fontSize: 10, lineHeight: 14 },
});
