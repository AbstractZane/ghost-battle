import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@/constants/defaults';

import {
  cameraPreferencePatch,
  DEFAULT_CAMERA_FACING,
  oppositeCameraFacing,
  resolveAvailableCameraFacing,
} from './cameraSelection';

describe('camera selection', () => {
  it('uses the front camera by default', () => {
    expect(DEFAULT_CAMERA_FACING).toBe('front');
    expect(DEFAULT_SETTINGS.preferredCamera).toBe('front');
  });

  it('switches between front and back cameras', () => {
    expect(oppositeCameraFacing('front')).toBe('back');
    expect(oppositeCameraFacing('back')).toBe('front');
  });

  it('persists the selected camera through the settings contract', () => {
    expect(cameraPreferencePatch('back')).toEqual({ preferredCamera: 'back' });
    expect(cameraPreferencePatch('front')).toEqual({ preferredCamera: 'front' });
  });

  it('uses the preferred camera when available and safely falls back when it is not', () => {
    expect(resolveAvailableCameraFacing('back', { front: true, back: true })).toBe('back');
    expect(resolveAvailableCameraFacing('front', { front: false, back: true })).toBe('back');
    expect(resolveAvailableCameraFacing('front', { front: false, back: false })).toBeNull();
  });
});
