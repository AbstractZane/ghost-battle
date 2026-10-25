import { useCallback, useState } from 'react';

import { cameraPreferencePatch, oppositeCameraFacing } from '@/pose/cameraSelection';
import type { CameraFacing } from '@/pose/cameraDisplay';
import { useAppStore } from '@/store/appStore';

export function usePreferredCamera() {
  const preferredCamera = useAppStore((state) => state.settings.preferredCamera);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const [facing, setFacing] = useState<CameraFacing>(preferredCamera);

  const selectFacing = useCallback(
    (next: CameraFacing) => {
      setFacing(next);
      void updateSettings(cameraPreferencePatch(next)).catch(() => undefined);
    },
    [updateSettings],
  );

  const flipFacing = useCallback(() => {
    selectFacing(oppositeCameraFacing(facing));
  }, [facing, selectFacing]);

  return { facing, selectFacing, flipFacing };
}
