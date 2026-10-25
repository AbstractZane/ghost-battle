import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POSE_MODEL,
  fallbackModelAfterFailure,
  getPoseModelConfig,
  MOVENET_LIGHTNING,
  MOVENET_THUNDER,
  shouldResetTrackerForModelChange,
  validatePoseModelContract,
} from './poseModels';

describe('MoveNet model configuration', () => {
  it('configures Lightning and Thunder with their distinct official input dimensions', () => {
    expect(getPoseModelConfig(MOVENET_LIGHTNING)).toMatchObject({
      inputWidth: 192,
      inputHeight: 192,
      inputDataType: 'uint8',
      keypointCount: 17,
    });
    expect(getPoseModelConfig(MOVENET_THUNDER)).toMatchObject({
      inputWidth: 256,
      inputHeight: 256,
      inputDataType: 'uint8',
      keypointCount: 17,
    });
    expect(DEFAULT_POSE_MODEL).toBe(MOVENET_LIGHTNING);
  });

  it.each([MOVENET_LIGHTNING, MOVENET_THUNDER])(
    'accepts the actual MoveNet tensor contract for %s',
    (model) => {
      const config = getPoseModelConfig(model);
      expect(
        validatePoseModelContract(
          {
            inputs: [
              {
                name: 'serving_default_input:0',
                dataType: 'uint8',
                shape: [1, config.inputHeight, config.inputWidth, 3],
              },
            ],
            outputs: [
              { name: 'StatefulPartitionedCall:0', dataType: 'float32', shape: [1, 1, 17, 3] },
            ],
          },
          config,
        ).valid,
      ).toBe(true);
    },
  );

  it('rejects a mismatched runtime tensor shape before inference', () => {
    const contract = validatePoseModelContract(
      {
        inputs: [{ name: 'input', dataType: 'uint8', shape: [1, 192, 192, 3] }],
        outputs: [{ name: 'output', dataType: 'float32', shape: [1, 1, 17, 3] }],
      },
      getPoseModelConfig(MOVENET_THUNDER),
    );
    expect(contract.valid).toBe(false);
    expect(contract.reason).toContain('[1,256,256,3]');
  });

  it('falls back only from Thunder to Lightning', () => {
    expect(fallbackModelAfterFailure(MOVENET_THUNDER)).toBe(MOVENET_LIGHTNING);
    expect(fallbackModelAfterFailure(MOVENET_LIGHTNING)).toBeNull();
  });

  it('requires a tracker reset only when an already-active model changes', () => {
    expect(shouldResetTrackerForModelChange(null, MOVENET_THUNDER)).toBe(false);
    expect(shouldResetTrackerForModelChange(MOVENET_THUNDER, MOVENET_THUNDER)).toBe(false);
    expect(shouldResetTrackerForModelChange(MOVENET_THUNDER, MOVENET_LIGHTNING)).toBe(true);
  });
});
