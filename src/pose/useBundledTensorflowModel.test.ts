// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBundledTensorflowModel, useBundledTensorflowModel } from './useBundledTensorflowModel';

const mocks = vi.hoisted(() => ({
  fromModule: vi.fn(),
  download: vi.fn(),
  loadModel: vi.fn(),
}));
vi.mock('expo-asset', () => ({ Asset: { fromModule: mocks.fromModule } }));
vi.mock('react-native-fast-tflite', () => ({ loadTensorflowModel: mocks.loadModel }));

let root: Root | undefined;
let latestState: string | undefined;
async function update(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
async function mount() {
  function Harness() {
    latestState = useBundledTensorflowModel(6).state;
    return null;
  }
  root = createRoot(document.createElement('div'));
  await update(() => root?.render(createElement(Harness)));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.fromModule.mockReturnValue({ downloadAsync: mocks.download });
  mocks.download.mockResolvedValue({ localUri: 'file:///data/user/0/app/cache/pose.tflite' });
  mocks.loadModel.mockResolvedValue({ dispose: vi.fn() });
});
afterEach(async () => {
  await update(() => root?.unmount());
  root = undefined;
  latestState = undefined;
  vi.unstubAllGlobals();
});

describe('bundled native MoveNet loading', () => {
  it('materializes the APK resource as a local file before calling the URL-only TFLite loader', async () => {
    await loadBundledTensorflowModel(6);
    expect(mocks.fromModule).toHaveBeenCalledWith(6);
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.loadModel).toHaveBeenCalledExactlyOnceWith(
      { url: 'file:///data/user/0/app/cache/pose.tflite' },
      [],
    );
  });

  it('fails safely if the asset has no usable local URI, without falling back to a remote URL', async () => {
    mocks.download.mockResolvedValue({ localUri: null, uri: 'https://example.com/pose.tflite' });
    await expect(loadBundledTensorflowModel(6)).rejects.toThrow('local file');
    expect(mocks.loadModel).not.toHaveBeenCalled();
  });

  it('propagates resource-copy failure without attempting inference', async () => {
    mocks.download.mockRejectedValue(new Error('APK resource unavailable'));
    await expect(loadBundledTensorflowModel(6)).rejects.toThrow('APK resource unavailable');
    expect(mocks.loadModel).not.toHaveBeenCalled();
  });

  it('disposes the owned model exactly once when its camera unmounts', async () => {
    const dispose = vi.fn();
    mocks.loadModel.mockResolvedValue({ dispose });
    await mount();
    expect(latestState).toBe('loaded');
    await update(() => root?.unmount());
    root = undefined;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('disposes a late load instead of publishing a result to an unmounted camera', async () => {
    const dispose = vi.fn();
    let resolveModel: ((model: { dispose: () => void }) => void) | undefined;
    mocks.loadModel.mockReturnValue(
      new Promise<{ dispose: () => void }>((resolve) => {
        resolveModel = resolve;
      }),
    );
    await mount();
    expect(latestState).toBe('loading');
    await update(() => root?.unmount());
    root = undefined;
    await update(() => resolveModel?.({ dispose }));
    expect(dispose).toHaveBeenCalledOnce();
    expect(latestState).toBe('loading');
  });
});
