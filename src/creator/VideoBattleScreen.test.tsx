// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import type * as ReactNative from 'react-native';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/constants/defaults';
import type { PoseResult } from '@/pose/poseTypes';
import type { ExerciseDetectionResult } from '@/exercises/pushup/pushupTypes';
import { validRepSequence } from '@/tests/poseFixtures';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    listeners,
    frame: undefined as ((result: ExerciseDetectionResult, timestamp: number) => void) | undefined,
    nextRep: null as number | null,
    accept: false,
    ready: true,
    released: false,
    camera: undefined as
      { onPose(pose: PoseResult): void; onError(error: string): void } | undefined,
    navigation: { replace: vi.fn(), popTo: vi.fn() },
    sound: { play: vi.fn(), stopScope: vi.fn() },
    session: {
      detection: {},
      latestPose: null,
      feedback: 'GOOD REP',
      processPose: vi.fn(),
      resetTracking: vi.fn(),
      setPaused: vi.fn(),
      invalidatePartialTracking: vi.fn(),
    },
    player: {
      duration: 5,
      currentTime: 0,
      playing: false,
      status: 'readyToPlay',
      play: vi.fn(),
      pause: vi.fn(),
      addListener: (event: string, listener: (value: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        return { remove: () => set.delete(listener) };
      },
    },
  };
});
vi.mock('react-native', async () => {
  const name = 'react-native-web';
  const native = (await import(name)) as typeof ReactNative;
  return {
    ...native,
    Modal: ({ visible, children }: React.PropsWithChildren<{ visible: boolean }>) =>
      visible ? <div>{children}</div> : null,
  };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => mocks.navigation,
  useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  useIsFocused: () => true,
  usePreventRemove: vi.fn(),
}));
vi.mock('expo-video', () => ({
  useVideoPlayer: (_source: string, setup: (player: typeof mocks.player) => void) => {
    useEffect(
      () => () => {
        mocks.released = true;
      },
      [],
    );
    setup(mocks.player);
    return mocks.player;
  },
  VideoView: () => <div>Video opponent</div>,
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-haptics', () => ({ notificationAsync: vi.fn() }));
vi.mock('@/audio/SoundEffectsContext', () => ({ useSoundEffects: () => mocks.sound }));
vi.mock('@/audio/SoundToggle', () => ({ SoundToggle: () => null }));
vi.mock('@/components/PlayerAvatar', () => ({
  PlayerAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock('./StudioAvatar', () => ({
  StudioAvatar: ({ name, photoUri }: { name: string; photoUri: string | null }) => (
    <span data-photo={photoUri} data-avatar-name={name}>
      {name}
    </span>
  ),
}));
vi.mock('./studioProfilesRepository', () => ({
  studioProfilesRepository: {
    load: () =>
      Promise.resolve({
        version: 1,
        player: { name: 'My Studio name', photoUri: 'file:///app/me.jpg' },
        opponent: { name: 'Custom rival', photoUri: 'file:///app/rival.jpg' },
      }),
  },
}));
vi.mock('@/components/SkeletonOverlay', () => ({ SkeletonOverlay: () => null }));
vi.mock('@/components/PoseCamera', () => ({
  PoseCamera: (props: NonNullable<typeof mocks.camera>) => {
    mocks.camera = props;
    return <div>Local camera</div>;
  },
}));
vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress(): void;
  }) => (
    <button aria-label={label} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock('@/components/SoundPressable', () => ({
  SoundPressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: React.PropsWithChildren<{ onPress(): void; accessibilityLabel: string }>) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('@/multiplayer/results/MatchVictoryCelebration', () => ({
  MatchVictoryCelebration: () => <div data-testid="victory">Victory animation</div>,
}));
vi.mock('@/shop/CosmeticArtwork', () => ({ AvatarFrame: () => null }));
vi.mock('@/components/useRankAnimation', async () => {
  const { Animated } = await import('react-native');
  return { useRankAnimation: () => ({ progress: new Animated.Value(1), playing: false }) };
});
vi.mock('@/hooks/usePreferredCamera', () => ({
  usePreferredCamera: () => ({ facing: 'front', flipFacing: vi.fn(), selectFacing: vi.fn() }),
}));
vi.mock('@/hooks/useWorkoutSession', () => ({
  useWorkoutSession: (
    _config: unknown,
    options: { acceptReps: boolean; onDetectorFrame: typeof mocks.frame },
  ) => {
    mocks.accept = options.acceptReps;
    mocks.frame = options.onDetectorFrame;
    return mocks.session;
  },
}));
vi.mock('@/workouts/workoutPoseReady', () => ({ workoutPoseReady: () => mocks.ready }));
vi.mock('@/store/appStore', () => ({
  useAppStore: (
    select: (state: {
      settings: typeof DEFAULT_SETTINGS;
      profile: { displayName: string };
    }) => unknown,
  ) =>
    select({
      settings: { ...DEFAULT_SETTINGS, haptics: false },
      profile: { displayName: 'Athlete' },
    }),
}));
vi.mock('./clipRepository', () => ({
  clipRepository: {
    load: () =>
      Promise.resolve({
        version: 1,
        id: 'clip',
        name: 'Custom rival',
        uri: 'file:///app/clip.mp4',
        durationMs: 5000,
        repTimesMs: [2000, 4000],
      }),
  },
}));
import { VideoBattleScreen } from './VideoBattleScreen';
let root: Root, host: HTMLDivElement;
const update = (callback: () => void) =>
  act(async () => {
    callback();
    await Promise.resolve();
  });
const pose = validRepSequence()[0]!;
const click = (label: string) =>
  update(() => {
    host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
  });
const emit = (event: string, payload?: unknown) =>
  update(() => {
    for (const listener of [...(mocks.listeners.get(event) ?? [])]) listener(payload);
  });
const feed = (rep?: number) =>
  update(() => {
    mocks.nextRep = rep ?? null;
    mocks.camera!.onPose(pose);
  });
async function start() {
  await update(() => {
    const props = {
      route: { key: 'take', params: { clipId: 'clip' } },
      navigation: mocks.navigation,
    } as unknown as React.ComponentProps<typeof VideoBattleScreen>;
    root.render(<VideoBattleScreen {...props} />);
  });
  for (let i = 0; i < 30; i++) {
    await feed();
    await update(() => {
      vi.advanceTimersByTime(100);
    });
  }
  expect(mocks.player.play).toHaveBeenCalledOnce();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.listeners.clear();
  mocks.player.currentTime = 0;
  mocks.player.playing = false;
  mocks.ready = true;
  mocks.released = false;
  mocks.player.play.mockImplementation(() => {
    mocks.player.playing = true;
  });
  mocks.player.pause.mockImplementation(() => {
    if (mocks.released) throw new Error('ERR_USING_RELEASED_SHARED_OBJECT');
    mocks.player.playing = false;
  });
  mocks.session.processPose.mockImplementation((incoming: PoseResult) => {
    const rep = mocks.accept && mocks.nextRep !== null ? { index: mocks.nextRep } : undefined;
    mocks.frame?.({ rep } as ExerciseDetectionResult, incoming.timestamp);
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('starts from fresh setup, scores accepted reps, and shows the website victory treatment at clip end', async () => {
  await start();
  expect(host.textContent).toContain('My Studio name');
  expect(host.textContent).toContain('Custom rival');
  expect(host.querySelector('[data-photo="file:///app/me.jpg"]')).not.toBeNull();
  expect(host.querySelector('[data-photo="file:///app/rival.jpg"]')).not.toBeNull();
  expect(mocks.session.resetTracking).toHaveBeenCalledOnce();
  mocks.player.currentTime = 1;
  await emit('timeUpdate', { currentTime: 1 });
  await feed(1);
  await feed(1);
  await feed(2);
  await feed(3);
  expect(host.querySelector('[aria-label="3 pushups"]')).not.toBeNull();
  mocks.player.currentTime = 5;
  await emit('playToEnd');
  expect(host.textContent).toContain('WIN');
  expect(host.textContent).toContain('Won by 1 push-up');
  expect(host.textContent).not.toContain('RATING PREVIEW');
  expect(host.querySelector('[data-testid="victory"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-photo="file:///app/me.jpg"]').length).toBeGreaterThan(1);
  expect(host.querySelectorAll('[data-photo="file:///app/rival.jpg"]').length).toBeGreaterThan(1);
  expect(host.textContent).not.toContain('Local camera');
  expect(mocks.session.setPaused).toHaveBeenLastCalledWith(true);
  await click('RACE AGAIN');
  expect(mocks.navigation.replace).toHaveBeenCalledWith('VideoBattle', { clipId: 'clip' });
});
it('freezes both sides in the menu and discards partial tracking on resume', async () => {
  await start();
  mocks.player.currentTime = 1;
  await emit('timeUpdate', { currentTime: 1 });
  await feed(1);
  await click('Battle menu');
  expect(host.textContent).toContain('Both scores and the clip are paused');
  await feed(2);
  await emit('timeUpdate', { currentTime: 4 });
  expect(host.querySelector('[aria-label="1 pushups"]')).not.toBeNull();
  await click('RESUME');
  expect(mocks.session.invalidatePartialTracking).toHaveBeenCalledWith('demo-resume');
  expect(mocks.player.play).toHaveBeenCalledTimes(2);
});
it('restarts from the menu through a fresh battle route rather than replaying accepted rep indices', async () => {
  await start();
  await click('Battle menu');
  await click('RESTART CHALLENGE');
  expect(mocks.navigation.replace).toHaveBeenCalledWith('VideoBattle', { clipId: 'clip' });
});
it('gives tracking a fresh window after a long manual pause', async () => {
  await start();
  await click('Battle menu');
  await update(() => vi.advanceTimersByTime(10_000));
  await click('RESUME');
  await update(() => vi.advanceTimersByTime(250));
  expect(host.textContent).not.toContain('Camera tracking stopped');
  await feed(1);
  expect(mocks.player.play).toHaveBeenCalledTimes(2);
});
it('pauses on camera failure and blocks resume until deliberate recovery', async () => {
  await start();
  await update(() => {
    mocks.camera!.onError('Camera unavailable');
  });
  expect(host.textContent).toContain('Camera unavailable');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="RESUME"]')!.disabled).toBe(true);
  await click('RETRY CAMERA');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="RESUME"]')!.disabled).toBe(false);
});
it('pauses on a silent camera stall and requires recovery before accepting more reps', async () => {
  await start();
  await update(() => vi.advanceTimersByTime(2250));
  expect(host.textContent).toContain('Camera tracking stopped');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="RESUME"]')!.disabled).toBe(true);
  await feed(1);
  expect(host.querySelector('[aria-label="1 pushups"]')).toBeNull();
  await click('RETRY CAMERA');
  await click('RESUME');
  expect(mocks.session.invalidatePartialTracking).toHaveBeenCalledWith('demo-resume');
});
it('uses the actual playback clock instead of stale time-event payloads and reconciles a backward seek', async () => {
  await start();
  mocks.player.currentTime = 3;
  await emit('timeUpdate', { currentTime: 999 });
  await feed(1);
  expect(host.textContent).toContain('GHOST · 1');
  mocks.player.currentTime = 1;
  await emit('timeUpdate', { currentTime: 3 });
  expect(host.textContent).toContain('GHOST · 0');
  expect(host.querySelector('[aria-label="1 pushups"]')).not.toBeNull();
  await feed(1);
  expect(host.querySelector('[aria-label="2 pushups"]')).toBeNull();
});
it.each([
  [0, 'LOSS'],
  [2, 'TIE'],
] as const)('finishes %s live reps with the correct %s screen', async (score, result) => {
  await start();
  mocks.player.currentTime = 1;
  await emit('timeUpdate', { currentTime: 1 });
  for (let rep = 1; rep <= score; rep++) await feed(rep);
  mocks.player.currentTime = 5;
  await emit('playToEnd');
  expect(host.textContent).toContain(result);
  expect(host.querySelector('[data-testid="victory"]')).toBeNull();
  await click('CHALLENGE LIBRARY');
  expect(mocks.navigation.popTo).toHaveBeenCalledWith('CreatorStudio');
});
