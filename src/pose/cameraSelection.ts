import type { AppSettings } from '@/types/models';

import type { CameraFacing } from './cameraDisplay';

export const DEFAULT_CAMERA_FACING: CameraFacing = 'front';

export function oppositeCameraFacing(facing: CameraFacing): CameraFacing {
  return facing === 'front' ? 'back' : 'front';
}

export function resolveAvailableCameraFacing(
  preferred: CameraFacing,
  availability: { front: boolean; back: boolean },
): CameraFacing | null {
  if (availability[preferred]) return preferred;
  const fallback = oppositeCameraFacing(preferred);
  return availability[fallback] ? fallback : null;
}

export function cameraPreferencePatch(facing: CameraFacing): Pick<AppSettings, 'preferredCamera'> {
  return { preferredCamera: facing };
}
