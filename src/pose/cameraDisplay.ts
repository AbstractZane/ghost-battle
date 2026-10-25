export type CameraFacing = 'front' | 'back';

export interface CameraDisplayPolicy {
  mirrorMode: 'on' | 'off';
  displayMirrored: boolean;
}

/**
 * Keeps native preview mirroring and landmark projection in one policy. Model
 * input is canonicalized separately from Frame.isMirrored and must not be
 * changed here.
 */
export function cameraDisplayPolicy(facing: CameraFacing): CameraDisplayPolicy {
  const displayMirrored = facing === 'front';
  return {
    mirrorMode: displayMirrored ? 'on' : 'off',
    displayMirrored,
  };
}
