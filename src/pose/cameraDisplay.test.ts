import { describe, expect, it } from 'vitest';

import { cameraDisplayPolicy } from './cameraDisplay';

describe('camera display policy', () => {
  it('uses one native mirror for the front camera', () => {
    expect(cameraDisplayPolicy('front')).toEqual({
      mirrorMode: 'on',
      displayMirrored: true,
    });
  });

  it('does not mirror the back camera', () => {
    expect(cameraDisplayPolicy('back')).toEqual({
      mirrorMode: 'off',
      displayMirrored: false,
    });
  });
});
