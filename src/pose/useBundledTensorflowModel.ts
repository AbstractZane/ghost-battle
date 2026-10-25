import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import {
  loadTensorflowModel,
  type TensorflowModel,
  type TensorflowPlugin,
} from 'react-native-fast-tflite';

/** The TFLite 3 Android loader accepts URLs, not release APK resource names. */
export async function loadBundledTensorflowModel(assetModule: number): Promise<TensorflowModel> {
  const asset = await Asset.fromModule(assetModule).downloadAsync();
  if (!asset.localUri?.startsWith('file://')) {
    throw new Error('Bundled pose model could not be resolved to a local file.');
  }
  return loadTensorflowModel({ url: asset.localUri }, []);
}

/** Owns one model; late loads are disposed instead of reviving an old camera. */
export function useBundledTensorflowModel(assetModule: number): TensorflowPlugin {
  const [state, setState] = useState<TensorflowPlugin>({ state: 'loading', model: undefined });
  useEffect(() => {
    let cancelled = false;
    let ownedModel: TensorflowModel | undefined;
    setState({ state: 'loading', model: undefined });
    void loadBundledTensorflowModel(assetModule).then(
      (model) => {
        if (cancelled) {
          model.dispose();
          return;
        }
        ownedModel = model;
        setState({ state: 'loaded', model });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setState({
          state: 'error',
          model: undefined,
          error: cause instanceof Error ? cause : new Error('Bundled pose model loading failed.'),
        });
      },
    );
    return () => {
      cancelled = true;
      ownedModel?.dispose();
    };
  }, [assetModule]);
  return state;
}
