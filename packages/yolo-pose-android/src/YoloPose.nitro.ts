import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

/** Local Android-only ONNX experiment. Raw camera buffers never cross this API. */
export interface YoloPose extends HybridObject<{ android: 'kotlin' }> {
  start(): string;
  /** Copies one frame to a dedicated inference worker and returns a prior completed pose. */
  submit(frame: Frame): string | undefined;
  stop(): void;
}
