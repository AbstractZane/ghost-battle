import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native';
import type {
  NativeStackScreenProps,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { PoseCamera } from '@/components/PoseCamera';
import { SkeletonOverlay } from '@/components/SkeletonOverlay';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useReducedInteractionMotion } from '@/components/InteractionMotion';
import { useCameraRecovery } from '@/hooks/useCameraRecovery';
import { usePreferredCamera } from '@/hooks/usePreferredCamera';
import { useWorkoutSession } from '@/hooks/useWorkoutSession';
import { useSoundEffects } from '@/audio/SoundEffectsContext';
import { SoundToggle } from '@/audio/SoundToggle';
import { useAppStore } from '@/store/appStore';
import { workoutPoseReady } from '@/workouts/workoutPoseReady';
import { cameraGuidance } from '@/workouts/cameraGuidance';
import { createId } from '@/utils/format';
import type { RootStackParamList } from '@/types/navigation';
import type { PoseResult } from '@/pose/poseTypes';
import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';
import { clipRepository } from './clipRepository';
import { VideoRivalRound, type VideoRivalClip } from './videoRival';
import { defaultStudioProfiles, type StudioProfiles } from './studioProfiles';
import { studioProfilesRepository } from './studioProfilesRepository';
import { StudioAvatar } from './StudioAvatar';
import { GhostResultsOverlay } from './GhostResultsOverlay';
import { GhostScoreboard, GhostRepCounter, GhostBattleFeedback } from './GhostScoreboard';

type Props = NativeStackScreenProps<RootStackParamList, 'VideoBattle'>;
export function VideoBattleScreen({ route, navigation }: Props) {
  const [clip, setClip] = useState<VideoRivalClip | null>(null);
  const [profiles, setProfiles] = useState<StudioProfiles | null>(null);
  const fallbackName = useAppStore((state) => state.profile.displayName);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([clipRepository.load(), studioProfilesRepository.load()])
      .then(([saved, savedProfiles]) => {
        if (!active) return;
        if (!saved || saved.id !== route.params.clipId || !saved.repTimesMs.length)
          setError('Choose a video and add its rep timings first.');
        else {
          const identities = savedProfiles ?? defaultStudioProfiles(fallbackName, saved.name);
          setProfiles({ ...identities, opponent: { ...identities.opponent, name: saved.name } });
          setClip(saved);
        }
      })
      .catch(() => {
        if (active) setError('The video could not load. Choose it again in Studio.');
      });
    return () => {
      active = false;
    };
  }, [fallbackName, route.params.clipId]);
  if (!clip || !profiles)
    return (
      <SafeAreaView style={styles.loading}>
        {error ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <PrimaryButton
              label="CHALLENGE LIBRARY"
              onPress={() => navigation.popTo('CreatorStudio')}
            />
          </>
        ) : (
          <ActivityIndicator color="#C9FF9F" />
        )}
      </SafeAreaView>
    );
  return <VideoBattle key={route.key} clip={clip} profiles={profiles} />;
}

function VideoBattle({ clip, profiles }: { clip: VideoRivalClip; profiles: StudioProfiles }) {
  const wide = useWindowDimensions().width >= 800;
  const screenFocused = useIsFocused();
  const reduced = useReducedInteractionMotion();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [round] = useState(() => new VideoRivalRound(clip));
  const [identity] = useState(() => createId('staged-take'));
  const [snapshot, setSnapshot] = useState(() => round.snapshot());
  const [countdown, setCountdown] = useState(3);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [leaving, setLeaving] = useState<'library' | 'restart' | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const focused = useRef(false);
  const deadline = useRef(0);
  const lastCue = useRef<number | null>(null);
  const lastPoseAt = useRef(0);
  const readiness = useRef(false);
  const settings = useAppStore((state) => state.settings);
  const name = profiles.player.name;
  const opponent = profiles.opponent.name;
  const sound = useSoundEffects();
  const { facing, flipFacing, selectFacing } = usePreferredCamera();
  const player = useVideoPlayer(clip.uri, (video) => {
    video.muted = true;
    video.audioMixingMode = 'mixWithOthers';
    video.loop = false;
    video.timeUpdateEventInterval = 0.05;
    video.staysActiveInBackground = false;
    video.allowsExternalPlayback = false;
  });
  const publish = useCallback(() => setSnapshot(round.snapshot()), [round]);
  const onDetectorFrame = useCallback(
    (result: ExerciseDetectionResult) => {
      readiness.current = workoutPoseReady(result);
      if (result.rep && round.acceptRep(result.rep.index)) publish();
    },
    [publish, round],
  );
  const workout = useWorkoutSession(undefined, {
    acceptReps: snapshot.phase === 'active',
    repFeedback: false,
    onDetectorFrame,
  });
  const pause = useCallback(() => {
    round.pause();
    player.pause();
    workout.setPaused(true);
    publish();
  }, [player, publish, round, workout.setPaused]);
  const processPose = useCallback(
    (pose: PoseResult) => {
      if (!focused.current) return;
      const phase = round.snapshot().phase;
      if (phase === 'paused' || phase === 'complete') return;
      lastPoseAt.current = Date.now();
      if (phase === 'active') {
        round.observe(player.currentTime * 1000, player.playing && player.status === 'readyToPlay');
        if (!round.canAcceptReps()) return;
      }
      workout.processPose(pose);
    },
    [player, round, workout.processPose],
  );
  const invalidate = useCallback(
    (reason?: string) => {
      readiness.current = false;
      workout.invalidatePartialTracking(reason);
      if (reason === 'camera-error') {
        pause();
        setMenu(true);
      }
    },
    [pause, workout.invalidatePartialTracking],
  );
  const camera = useCameraRecovery({
    onPose: processPose,
    onInvalidate: invalidate,
    active: snapshot.phase !== 'paused' && snapshot.phase !== 'complete',
    sourceId: identity,
  });
  useEffect(() => {
    focused.current = screenFocused;
    if (!screenFocused) pause();
    return () => {
      focused.current = false;
      sound.stopScope(identity);
      // useVideoPlayer releases native playback itself. Calling pause here can
      // access a released shared object when leaving or replacing a take.
    };
  }, [identity, pause, screenFocused, sound]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && round.snapshot().phase !== 'complete') {
        pause();
        setMenu(true);
      }
    });
    return () => sub.remove();
  }, [pause, round]);
  useEffect(() => {
    const metadata = (duration: number) => {
      if (Math.abs(duration * 1000 - clip.durationMs) > 250) {
        pause();
        setError('The clip length changed. Return to Studio and check its timings.');
        setMenu(true);
      } else setVideoReady(true);
    };
    if (player.duration > 0) metadata(player.duration);
    const load = player.addListener('sourceLoad', ({ duration }) => metadata(duration));
    const status = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        pause();
        setVideoReady(false);
        setError('The video stopped. Return to Studio and choose a playable MP4.');
        setMenu(true);
      } else if (status === 'readyToPlay') {
        metadata(player.duration);
      } else if (status === 'loading' && round.snapshot().phase === 'active') {
        round.observe(player.currentTime * 1000, false);
        workout.invalidatePartialTracking('video-buffering');
        publish();
      }
    });
    const time = player.addListener('timeUpdate', () => {
      // Read the player's current clock, not a possibly queued/stale event payload.
      const at = player.currentTime * 1000;
      if (round.snapshot().phase === 'active' && at < round.snapshot().elapsedMs) round.seek(at);
      round.observe(at, player.playing && player.status === 'readyToPlay');
      publish();
    });
    const end = player.addListener('playToEnd', () => {
      round.observe(player.currentTime * 1000, false, true);
      publish();
      workout.setPaused(true);
      if (round.snapshot().phase !== 'complete') {
        setError('The video ended early. Check its length and timings in Studio.');
        setMenu(true);
      }
    });
    return () => {
      load.remove();
      status.remove();
      time.remove();
      end.remove();
    };
  }, [
    clip.durationMs,
    pause,
    player,
    publish,
    round,
    workout.invalidatePartialTracking,
    workout.setPaused,
  ]);
  const ready = workoutPoseReady(workout.detection);
  useEffect(() => {
    if (snapshot.phase !== 'positioning' || !ready || !videoReady || menu || !focused.current)
      return;
    round.countdown();
    deadline.current = Date.now() + 3000;
    setCountdown(3);
    publish();
  }, [menu, publish, ready, round, snapshot.phase, videoReady]);
  useEffect(() => {
    if (snapshot.phase !== 'countdown') return;
    const timer = setInterval(() => {
      if (!focused.current || menu) return;
      // Same setup-evidence timeout as camera check. No detector threshold changes.
      if (!readiness.current || Date.now() - lastPoseAt.current > 750) {
        clearInterval(timer);
        round.cancelCountdown();
        lastCue.current = null;
        publish();
        return;
      }
      const remaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        clearInterval(timer);
        workout.resetTracking();
        workout.setPaused(false);
        round.start();
        player.currentTime = 0;
        player.play();
        publish();
        sound.play('go', { eventKey: `${identity}:go`, scope: identity });
      }
    }, 100);
    return () => clearInterval(timer);
  }, [
    identity,
    menu,
    player,
    publish,
    round,
    snapshot.phase,
    sound,
    workout.resetTracking,
    workout.setPaused,
  ]);
  useEffect(() => {
    if (snapshot.phase === 'countdown' && countdown > 0 && lastCue.current !== countdown) {
      lastCue.current = countdown;
      sound.play('countdown', {
        eventKey: `${identity}:countdown:${deadline.current}:${countdown}`,
        scope: identity,
      });
    }
  }, [countdown, identity, snapshot.phase, sound]);
  useEffect(() => {
    if (snapshot.phase !== 'complete' || !snapshot.outcome) return;
    player.pause();
    workout.setPaused(true);
  }, [player, snapshot.outcome, snapshot.phase, workout.setPaused]);
  usePreventRemove(!leaving && snapshot.phase !== 'complete', () => {
    pause();
    setMenu(true);
  });
  useEffect(() => {
    if (leaving === 'library') navigation.popTo('CreatorStudio');
    else if (leaving === 'restart') navigation.replace('VideoBattle', { clipId: clip.id });
  }, [clip.id, leaving, navigation]);
  const resume = () => {
    if (camera.error || trackingError || error || !videoReady) return;
    lastPoseAt.current = Date.now();
    round.resume();
    workout.setPaused(false);
    workout.invalidatePartialTracking('demo-resume');
    if (round.snapshot().phase === 'countdown') {
      deadline.current = Date.now() + 3000;
      setCountdown(3);
      lastCue.current = null;
    } else if (round.snapshot().phase === 'active') player.play();
    setMenu(false);
    publish();
  };
  useEffect(() => {
    if (snapshot.phase !== 'active') return;
    const watchdog = setInterval(() => {
      // Transport liveness only; no pose or counting threshold changes.
      if (focused.current && Date.now() - lastPoseAt.current > 2000) {
        pause();
        setTrackingError('Camera tracking stopped. Retry the camera, then resume your challenge.');
        setMenu(true);
      }
    }, 250);
    return () => clearInterval(watchdog);
  }, [pause, snapshot.phase]);
  const status =
    snapshot.phase === 'positioning'
      ? videoReady
        ? 'GET INTO POSITION'
        : 'PREPARING VIDEO…'
      : snapshot.phase === 'countdown'
        ? String(countdown || 'GO')
        : snapshot.phase === 'paused'
          ? 'PAUSED'
          : snapshot.phase === 'complete'
            ? 'ROUND COMPLETE'
            : cameraGuidance(workout.feedback);
  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <SafeAreaView edges={['top']} style={styles.scoreHeader}>
        <GhostScoreboard
          snapshot={snapshot}
          durationMs={clip.durationMs}
          onMenu={() => {
            pause();
            setMenu(true);
          }}
        />
      </SafeAreaView>
      <View style={[styles.arena, wide && styles.arenaWide]}>
        <View style={styles.opponentPanel}>
          <VideoView
            player={player}
            style={[StyleSheet.absoluteFill, styles.videoSurface]}
            contentFit="contain"
            surfaceType="textureView"
            nativeControls={false}
            allowsPictureInPicture={false}
            fullscreenOptions={{ enable: false }}
            useExoShutter={false}
          />
          <View pointerEvents="none" style={styles.opponentPlate}>
            <StudioAvatar name={opponent} photoUri={profiles.opponent.photoUri} size={32} />
            <View>
              <Text style={styles.opponentLabel}>GHOST · RECORDED</Text>
              <Text numberOfLines={1} style={styles.playerName}>
                {opponent}
              </Text>
            </View>
            <GhostRepCounter score={snapshot.opponentScore} own={false} />
          </View>
        </View>
        <View style={[styles.divider, wide && styles.wideDivider]} />
        <View style={styles.localPanel}>
          {snapshot.phase !== 'complete' ? (
            <PoseCamera
              key={camera.key}
              isActive={snapshot.phase !== 'paused' && !menu}
              facing={facing}
              onFacingResolved={selectFacing}
              onPose={camera.onPose}
              onError={camera.onError}
              showErrorOverlay={false}
            />
          ) : (
            <StudioAvatar name={name} photoUri={profiles.player.photoUri} size={80} />
          )}
          {settings.skeletonOverlay && workout.latestPose && snapshot.phase === 'active' ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <SkeletonOverlay
                landmarks={workout.latestPose.landmarks}
                displayMirrored={workout.latestPose.displayMirrored}
                sourceWidth={workout.latestPose.sourceWidth}
                sourceHeight={workout.latestPose.sourceHeight}
              />
            </View>
          ) : null}
          <SafeAreaView edges={['bottom']} pointerEvents="none" style={styles.localPlate}>
            <StudioAvatar name={name} photoUri={profiles.player.photoUri} size={32} />
            <View>
              <Text style={styles.youLabel}>YOU</Text>
              <Text numberOfLines={1} style={styles.playerName}>
                {name}
              </Text>
            </View>
            <GhostRepCounter score={snapshot.playerScore} own />
          </SafeAreaView>
        </View>
        <GhostBattleFeedback snapshot={snapshot} />
      </View>
      {snapshot.phase !== 'complete' && !menu ? (
        <View pointerEvents="none" style={[styles.cue, wide && styles.wideCue]}>
          <Text style={[styles.cueText, snapshot.phase === 'countdown' && styles.countdown]}>
            {status}
          </Text>
        </View>
      ) : null}
      <Modal
        transparent
        visible={menu && snapshot.phase !== 'complete'}
        animationType={reduced ? 'none' : 'fade'}
        onRequestClose={resume}
      >
        <SafeAreaView style={styles.scrim}>
          <View style={styles.menuPanel}>
            <Text style={styles.resultHeading}>BATTLE PAUSED</Text>
            {camera.error || trackingError || error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {camera.error ?? trackingError ?? error}
              </Text>
            ) : (
              <Text style={styles.menuCopy}>Both scores and the clip are paused.</Text>
            )}
            {camera.error || trackingError ? (
              <PrimaryButton
                label="RETRY CAMERA"
                onPress={() => {
                  setTrackingError(null);
                  lastPoseAt.current = Date.now();
                  camera.restart();
                }}
              />
            ) : null}
            <PrimaryButton
              label="RESUME"
              disabled={!!camera.error || !!trackingError || !!error || !videoReady}
              onPress={resume}
            />
            <PrimaryButton
              label="FLIP CAMERA"
              variant="secondary"
              onPress={() => {
                camera.restart();
                flipFacing();
              }}
            />
            <SoundToggle />
            <PrimaryButton
              label="RESTART CHALLENGE"
              variant="secondary"
              onPress={() => setLeaving('restart')}
            />
            <PrimaryButton
              label="CHALLENGE LIBRARY"
              variant="quiet"
              onPress={() => setLeaving('library')}
            />
          </View>
        </SafeAreaView>
      </Modal>
      {snapshot.phase === 'complete' ? (
        <GhostResultsOverlay
          identity={identity}
          snapshot={snapshot}
          profiles={profiles}
          onRematch={() => navigation.replace('VideoBattle', { clipId: clip.id })}
          onSetup={() => navigation.popTo('CreatorStudio')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  videoSurface: { width: '100%', height: '100%' },
  root: { flex: 1, backgroundColor: '#060910' },
  scoreHeader: { backgroundColor: '#0A111E' },
  arena: { flex: 1, overflow: 'hidden' },
  arenaWide: { flexDirection: 'row' },
  wideDivider: { width: 2, height: '100%' },
  wideCue: { left: '52%' },
  loading: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#080B12', gap: 14 },
  opponentPanel: { flex: 1, overflow: 'hidden', backgroundColor: '#030407' },
  localPanel: { flex: 1, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  topControls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  takeLabel: {
    color: '#E8DEFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 3,
    alignSelf: 'center',
    backgroundColor: '#0A0F19B8',
    borderRadius: 12,
    padding: 8,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D1221D9',
  },
  menuIcon: { color: '#F3F5FC', fontSize: 23 },
  opponentPlate: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#080D18C9',
  },
  localPlate: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 0,
    paddingTop: 6,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  opponentLabel: { color: '#BAA0F0', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  youLabel: { color: '#C9FF9F', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  playerName: { color: '#F4F6FC', fontSize: 14, fontWeight: '800', maxWidth: 150 },
  repCount: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '900',
    marginLeft: 'auto',
    textShadowColor: '#000',
    textShadowRadius: 8,
  },
  divider: {
    height: 2,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#101723',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#3D3556',
  },
  clock: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  matchBrand: { color: '#C9FF9F', fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  cue: {
    position: 'absolute',
    bottom: 100,
    left: 22,
    right: 22,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  cueText: {
    color: '#D6FFB4',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    backgroundColor: '#080D18CE',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  countdown: { fontSize: 68, minWidth: 100 },
  scrim: {
    flex: 1,
    backgroundColor: '#04070DB8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  menuPanel: {
    width: '100%',
    maxWidth: 420,
    padding: 22,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#404B5E',
    backgroundColor: '#101722',
    gap: 12,
  },
  error: { color: '#FF9BB2', fontSize: 13, lineHeight: 19 },
  menuCopy: { color: '#B5C0D0', fontSize: 13, lineHeight: 19 },
  resultHeading: {
    color: '#D1FF9D',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
});
