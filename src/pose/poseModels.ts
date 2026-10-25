export const MOVENET_LIGHTNING = 'movenet-lightning' as const;
export const MOVENET_THUNDER = 'movenet-thunder' as const;
/** Web-only 33-landmark candidate used by the parallel V6 experiment. */
export const BLAZEPOSE_FULL = 'blazepose-full' as const;
/** Android Detector Lab only; never a production default or silent fallback. */
export const YOLOXPOSE_TINY = 'yoloxpose-tiny-416' as const;

export type PoseModelId = typeof MOVENET_LIGHTNING | typeof MOVENET_THUNDER;
/** A model that may have produced a normalized PoseResult at runtime. */
export type RuntimePoseModelId = PoseModelId | typeof BLAZEPOSE_FULL | typeof YOLOXPOSE_TINY;

export interface PoseModelConfig {
  id: PoseModelId;
  label: 'LIGHTNING' | 'THUNDER';
  inputWidth: number;
  inputHeight: number;
  inputDataType: 'uint8';
  keypointCount: 17;
  outputValuesPerKeypoint: 3;
  outputDataType: 'float32';
  preprocessingMode: 'letterbox-rgb-uint8';
  coordinateConvention: 'normalized-y-x-score';
}

export interface TensorMetadata {
  name: string;
  dataType: string;
  shape: number[];
}

export interface PoseModelMetadata {
  inputs: ReadonlyArray<TensorMetadata>;
  outputs: ReadonlyArray<TensorMetadata>;
}

export interface PoseModelContractResult {
  valid: boolean;
  reason: string | null;
  input: TensorMetadata | null;
  output: TensorMetadata | null;
}

export interface PoseModelStatus {
  preference: RuntimePoseModelId;
  activeModel: RuntimePoseModelId | null;
  state: 'loading' | 'ready' | 'fallback' | 'error';
  fallbackReason: string | null;
  input: TensorMetadata | null;
  output: TensorMetadata | null;
}

export const POSE_MODEL_CONFIGS: Readonly<Record<PoseModelId, PoseModelConfig>> = {
  [MOVENET_LIGHTNING]: {
    id: MOVENET_LIGHTNING,
    label: 'LIGHTNING',
    inputWidth: 192,
    inputHeight: 192,
    inputDataType: 'uint8',
    keypointCount: 17,
    outputValuesPerKeypoint: 3,
    outputDataType: 'float32',
    preprocessingMode: 'letterbox-rgb-uint8',
    coordinateConvention: 'normalized-y-x-score',
  },
  [MOVENET_THUNDER]: {
    id: MOVENET_THUNDER,
    label: 'THUNDER',
    inputWidth: 256,
    inputHeight: 256,
    inputDataType: 'uint8',
    keypointCount: 17,
    outputValuesPerKeypoint: 3,
    outputDataType: 'float32',
    preprocessingMode: 'letterbox-rgb-uint8',
    coordinateConvention: 'normalized-y-x-score',
  },
};

/** PushForge real-device testing selected Lightning; Thunder remains available for comparison. */
export const DEFAULT_POSE_MODEL: PoseModelId = MOVENET_LIGHTNING;

export function getPoseModelConfig(model: PoseModelId): PoseModelConfig {
  return POSE_MODEL_CONFIGS[model];
}

export function fallbackModelAfterFailure(model: PoseModelId): PoseModelId | null {
  return model === MOVENET_THUNDER ? MOVENET_LIGHTNING : null;
}

export function shouldResetTrackerForModelChange(
  previous: PoseModelId | null,
  next: PoseModelId,
): boolean {
  return previous !== null && previous !== next;
}

export function validatePoseModelContract(
  metadata: PoseModelMetadata,
  config: PoseModelConfig,
): PoseModelContractResult {
  const input = metadata.inputs[0] ?? null;
  const output = metadata.outputs[0] ?? null;
  const expectedInput = [1, config.inputHeight, config.inputWidth, 3];
  const expectedOutput = [1, 1, config.keypointCount, config.outputValuesPerKeypoint];
  if (!input || !output) {
    return { valid: false, reason: 'Model tensors are unavailable.', input, output };
  }
  if (input.dataType !== config.inputDataType) {
    return {
      valid: false,
      reason: `Input tensor type ${input.dataType} does not match ${config.inputDataType}.`,
      input,
      output,
    };
  }
  if (!sameShape(input.shape, expectedInput)) {
    return {
      valid: false,
      reason: `Input tensor shape ${formatShape(input.shape)} does not match ${formatShape(expectedInput)}.`,
      input,
      output,
    };
  }
  if (output.dataType !== config.outputDataType) {
    return {
      valid: false,
      reason: `Output tensor type ${output.dataType} does not match ${config.outputDataType}.`,
      input,
      output,
    };
  }
  if (!sameShape(output.shape, expectedOutput)) {
    return {
      valid: false,
      reason: `Output tensor shape ${formatShape(output.shape)} does not match ${formatShape(expectedOutput)}.`,
      input,
      output,
    };
  }
  return { valid: true, reason: null, input, output };
}

export function safePoseModelError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown model initialization error.';
  const message = error.message.replace(/[\r\n]+/g, ' ').trim();
  return message.slice(0, 180) || 'Unknown model initialization error.';
}

function sameShape(actual: ReadonlyArray<number>, expected: ReadonlyArray<number>): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function formatShape(shape: ReadonlyArray<number>): string {
  return `[${shape.join(',')}]`;
}
