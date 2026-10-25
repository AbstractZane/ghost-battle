// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactNative from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultStudioProfiles, type StudioProfiles } from './studioProfiles';
const mocks = vi.hoisted(() => ({
  pick: vi.fn(),
  save: vi.fn(),
  discard: vi.fn(),
  saved: vi.fn(),
  close: vi.fn(),
}));
vi.mock('react-native', async () => {
  const name = 'react-native-web';
  const native = (await import(name)) as typeof ReactNative;
  return {
    ...native,
    Modal: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      editable,
    }: {
      accessibilityLabel: string;
      value: string;
      onChangeText(value: string): void;
      editable: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        value={value}
        disabled={!editable}
        onInput={(event) => onChangeText(event.currentTarget.value)}
        readOnly={false}
      />
    ),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/components/InteractionMotion', () => ({ useReducedInteractionMotion: () => false }));
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
    <button aria-label={label} disabled={disabled} onClick={onPress}>
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
vi.mock('./StudioAvatar', () => ({
  StudioAvatar: ({ name, photoUri }: { name: string; photoUri: string | null }) => (
    <span data-photo={photoUri}>{name}</span>
  ),
}));
vi.mock('./studioProfilesRepository', () => ({
  studioProfilesRepository: {
    pickPhoto: mocks.pick,
    save: mocks.save,
    discardPhoto: mocks.discard,
  },
}));
import { StudioProfilesEditor } from './StudioProfilesEditor';
let root: Root, host: HTMLDivElement;
let unmounted = false;
const draft = 'file:///app/creator-studio-portraits/new.jpg';
const update = (callback: () => void) =>
  act(async () => {
    callback();
    await Promise.resolve();
  });
const click = (name: string) =>
  update(() => {
    host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click();
  });
const render = () =>
  update(() => {
    root.render(
      <StudioProfilesEditor
        profiles={defaultStudioProfiles('Me', 'Them')}
        onSaved={mocks.saved}
        onClose={mocks.close}
      />,
    );
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.pick.mockResolvedValue(draft);
  mocks.discard.mockResolvedValue(undefined);
  mocks.save.mockImplementation((profiles: StudioProfiles) => Promise.resolve(profiles));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  unmounted = false;
});
afterEach(() => {
  if (!unmounted) act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('saves edited names and both pictures together, without discarding committed images', async () => {
  await render();
  await click('Change your profile picture');
  mocks.pick.mockResolvedValue('file:///app/creator-studio-portraits/rival.png');
  await click('Change opponent profile picture');
  await update(() => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Your Studio name"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'New name',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('SAVE PLAYERS');
  expect(mocks.saved).toHaveBeenCalledWith({
    version: 1,
    player: { name: 'New name', photoUri: draft },
    opponent: { name: 'Them', photoUri: 'file:///app/creator-studio-portraits/rival.png' },
  });
  act(() => root.unmount());
  unmounted = true;
  expect(mocks.discard).not.toHaveBeenCalled();
});
it('cancels and discards only the unsaved imported photo', async () => {
  await render();
  await click('Change your profile picture');
  await click('CANCEL');
  expect(mocks.close).toHaveBeenCalledOnce();
  act(() => root.unmount());
  unmounted = true;
  expect(mocks.discard).toHaveBeenCalledExactlyOnceWith(draft);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('does not delete an in-flight saved portrait if the screen unmounts', async () => {
  let complete!: (profiles: StudioProfiles) => void;
  mocks.save.mockImplementation(
    () =>
      new Promise<StudioProfiles>((resolve) => {
        complete = resolve;
      }),
  );
  await render();
  await click('Change your profile picture');
  await click('SAVE PLAYERS');
  act(() => root.unmount());
  unmounted = true;
  expect(mocks.discard).not.toHaveBeenCalled();
  await update(() =>
    complete({ ...defaultStudioProfiles('Me', 'Them'), player: { name: 'Me', photoUri: draft } }),
  );
  expect(mocks.discard).not.toHaveBeenCalled();
  expect(mocks.saved).not.toHaveBeenCalled();
});
it('keeps a failed save editable and cleans the draft only when leaving', async () => {
  mocks.save.mockRejectedValue(new Error('Storage is full'));
  await render();
  await click('Change opponent profile picture');
  await click('SAVE PLAYERS');
  expect(host.textContent).toContain('Storage is full');
  expect(mocks.discard).not.toHaveBeenCalled();
  expect(mocks.saved).not.toHaveBeenCalled();
  act(() => root.unmount());
  unmounted = true;
  expect(mocks.discard).toHaveBeenCalledExactlyOnceWith(draft);
});
