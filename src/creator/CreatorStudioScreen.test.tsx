// @vitest-environment jsdom
import React, { act, useEffect, useMemo } from 'react';
import type * as ReactNative from 'react-native';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VideoRivalClip } from './videoRival';
const mocks = vi.hoisted(() => ({
  pick: vi.fn(),
  load: vi.fn(),
  discard: vi.fn(),
  error: vi.fn(),
  focused: true,
  duration: 5,
  listeners: new Map<string, Set<(event: { status: string }) => void>>(),
  list: vi.fn(),
  open: vi.fn(),
  saveChallenge: vi.fn(),
  saveClip: vi.fn(),
  players: [] as Array<{ released: boolean; pause: ReturnType<typeof vi.fn>; currentTime: number }>,
  navigation: { navigate: vi.fn() },
}));
vi.mock('react-native', async () => {
  const name = 'react-native-web';
  return (await import(name)) as typeof ReactNative;
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => mocks.navigation,
  useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  useIsFocused: () => mocks.focused,
}));
vi.mock('expo-video', () => ({
  useVideoPlayer: (uri: string) => {
    const player = useMemo(() => {
      const state = {
        released: false,
        duration: mocks.duration,
        currentTime: 0,
        pause: vi.fn(),
        play: vi.fn(),
        addListener: (event: string, listener: (event: { status: string }) => void) => {
          const listeners = mocks.listeners.get(event) ?? new Set();
          listeners.add(listener);
          mocks.listeners.set(event, listeners);
          return { remove: () => listeners.delete(listener) };
        },
      };
      state.pause.mockImplementation(() => {
        if (state.released) throw new Error('ERR_USING_RELEASED_SHARED_OBJECT');
      });
      mocks.players.push(state);
      return state;
    }, [uri]);
    // Expo registers automatic release before the consumer's later effect cleanups.
    useEffect(
      () => () => {
        player.released = true;
      },
      [player],
    );
    return player;
  },
  VideoView: () => <div>Video preview</div>,
}));
vi.mock('@/store/appStore', () => ({
  useAppStore: (selector: (state: { profile: { displayName: string } }) => unknown) =>
    selector({ profile: { displayName: 'Athlete' } }),
}));
vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress(): void;
    disabled?: boolean;
  }) => (
    <button aria-label={label} onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
vi.mock('@/components/SoundPressable', () => ({
  SoundPressable: ({
    children,
    accessibilityLabel,
    onPress,
    disabled,
  }: React.PropsWithChildren<{
    accessibilityLabel: string;
    onPress(): void;
    disabled?: boolean;
  }>) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('@/components/ValueSlider', () => ({ ValueSlider: () => null }));
vi.mock('./StudioAvatar', () => ({ StudioAvatar: () => null }));
vi.mock('./StudioProfilesEditor', () => ({ StudioProfilesEditor: () => null }));
vi.mock('@/audio/SoundToggle', () => ({ SoundToggle: () => null }));
vi.mock('./ghostChallengeRepository', () => ({
  ghostChallengeRepository: { list: mocks.list, open: mocks.open, save: mocks.saveChallenge },
}));
vi.mock('./GhostChallengeLibrary', () => ({
  GhostChallengeLibrary: ({
    entries,
    onNew,
    onEdit,
    onRace,
  }: {
    entries: Array<{ id: string; title: string; clip: VideoRivalClip }>;
    onNew(): void;
    onEdit(entry: unknown): void;
    onRace(entry: unknown): void;
  }) => (
    <div>
      <button aria-label="CREATE GHOST" onClick={onNew}>
        New challenge
      </button>
      {entries.map((entry) => (
        <div key={entry.id}>
          {entry.title}
          <button aria-label={`Edit ${entry.title}`} onClick={() => onEdit(entry)}>
            Edit
          </button>
          <button aria-label={`Race ${entry.title}`} onClick={() => onRace(entry)}>
            Race
          </button>
        </div>
      ))}
    </div>
  ),
}));
vi.mock('./studioProfilesRepository', () => ({
  studioProfilesRepository: { load: () => Promise.resolve(null) },
}));
vi.mock('./clipRepository', () => ({
  clipRepository: {
    load: mocks.load,
    pick: mocks.pick,
    discard: mocks.discard,
    save: mocks.saveClip,
  },
}));
import { CreatorStudioScreen } from './CreatorStudioScreen';
class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <div>Studio error</div> : this.props.children;
  }
}
let root: Root, host: HTMLDivElement;
const clip: VideoRivalClip = {
  version: 1,
  id: 'first',
  uri: 'file:///app/first.mp4',
  name: 'Rival',
  durationMs: 5000,
  repTimesMs: [2000],
};
const update = (callback: () => void) =>
  act(async () => {
    callback();
    await Promise.resolve();
  });
const render = () =>
  update(() =>
    root.render(
      <Boundary>
        <CreatorStudioScreen />
      </Boundary>,
    ),
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.players.length = 0;
  mocks.focused = true;
  mocks.duration = 5;
  mocks.listeners.clear();
  mocks.load.mockResolvedValue(clip);
  mocks.list.mockResolvedValue([
    { version: 1, id: clip.id, title: 'Saved ghost', clip, savedAt: '2026-10-25T00:00:00Z' },
  ]);
  mocks.open.mockResolvedValue(clip);
  mocks.saveClip.mockImplementation((value: VideoRivalClip) => Promise.resolve(value));
  mocks.saveChallenge.mockImplementation((value: VideoRivalClip, title: string) =>
    Promise.resolve({
      version: 1,
      id: value.id,
      title,
      clip: value,
      savedAt: '2026-10-25T00:00:00Z',
    }),
  );
  mocks.discard.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host, { onCaughtError: mocks.error });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('replaces consecutive videos without pausing a player that Expo has already released', async () => {
  await render();
  await update(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Edit Saved ghost"]')!.click(),
  );
  for (const id of ['second', 'third']) {
    mocks.pick.mockResolvedValueOnce({ ...clip, id, uri: `file:///app/${id}.mp4` });
    await update(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="CHANGE VIDEO"]')!.click();
    });
    expect(mocks.error).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Studio error');
  }
  expect(mocks.players).toHaveLength(3);
  expect(mocks.players[0]!.released).toBe(true);
  expect(mocks.players[1]!.released).toBe(true);
});
it('pauses an existing preview on navigation blur while its player is still alive', async () => {
  await render();
  await update(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Edit Saved ghost"]')!.click(),
  );
  mocks.focused = false;
  await render();
  expect(mocks.players[0]!.pause).toHaveBeenCalledOnce();
  expect(mocks.players[0]!.released).toBe(false);
});
it('imports, marks, edits, saves and races a challenge through the complete setup flow', async () => {
  await render();
  mocks.pick.mockResolvedValue({
    ...clip,
    id: 'new',
    uri: 'file:///app/new.mp4',
    repTimesMs: [],
    durationMs: 0,
  });
  const click = (label: string) =>
    update(() => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  await click('CREATE GHOST');
  expect(host.textContent).toContain('MARK COMPLETED PUSH-UPS');
  mocks.players.at(-1)!.currentTime = 1;
  await click('MARK +1');
  await click('MARK +1');
  expect(host.textContent).toContain('1 REPS');
  await click('Next rep marker');
  await click('Remove selected rep marker');
  expect(host.textContent).toContain('0 REPS');
  await click('UNDO');
  expect(host.textContent).toContain('1 REPS');
  await click('SAVE & RACE GHOST');
  expect(mocks.saveChallenge).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'new', durationMs: 5000, repTimesMs: [1000] }),
    expect.any(String),
  );
  expect(mocks.navigation.navigate).toHaveBeenCalledWith('VideoBattle', { clipId: 'new' });
  expect(mocks.discard).not.toHaveBeenCalledWith('file:///app/new.mp4');
});
it('races a saved challenge without retiming it and preserves picker cancellation', async () => {
  await render();
  mocks.pick.mockResolvedValue(null);
  await update(() => host.querySelector<HTMLButtonElement>('[aria-label="CREATE GHOST"]')!.click());
  expect(host.textContent).toContain('Saved ghost');
  await update(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="Race Saved ghost"]')!.click(),
  );
  expect(mocks.saveClip).toHaveBeenCalledWith(clip);
  expect(mocks.navigation.navigate).toHaveBeenCalledWith('VideoBattle', { clipId: clip.id });
});

it('enables the editor when web decoding reports ready without emitting sourceLoad', async () => {
  await render();
  mocks.duration = 0;
  mocks.pick.mockResolvedValue({
    ...clip,
    id: 'web',
    uri: 'file:///app/web.mp4',
    durationMs: 0,
    repTimesMs: [],
  });
  await update(() => host.querySelector<HTMLButtonElement>('[aria-label="CREATE GHOST"]')!.click());
  expect(host.querySelector<HTMLButtonElement>('[aria-label="MARK +1"]')!.disabled).toBe(true);
  const player = mocks.players.at(-1)! as (typeof mocks.players)[number] & { duration: number };
  player.duration = 5;
  await update(() => {
    for (const listener of mocks.listeners.get('statusChange') ?? [])
      listener({ status: 'readyToPlay' });
  });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="MARK +1"]')!.disabled).toBe(false);
});
