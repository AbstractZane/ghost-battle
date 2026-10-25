export interface BrowserVideoDevice {
  deviceId: string;
  label: string;
}

export function webCameraConstraints(
  facing: 'front' | 'back',
  deviceId?: string,
): MediaStreamConstraints {
  return {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : {
          facingMode: { ideal: facing === 'front' ? 'user' : 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
  };
}

export function stopMediaStream(stream: Pick<MediaStream, 'getTracks'> | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function browserCameraError(error: unknown, stage: 'camera' | 'tracker' = 'camera'): string {
  const name =
    error instanceof DOMException ? error.name : error instanceof Error ? error.name : '';
  if (!window.isSecureContext) return 'Camera workouts require a secure HTTPS connection.';
  if (stage === 'tracker')
    return 'The rep tracker couldn’t start. Check your connection and try again. If it continues, open PushPVP in your device’s main browser.';
  if (name === 'NotAllowedError')
    return 'Allow Camera for PushPVP in your browser’s site settings and your device’s privacy settings, then try again.';
  if (name === 'SecurityError')
    return 'Camera access is blocked on this page. Open PushPVP directly in your browser and check its camera permissions.';
  if (name === 'NotSupportedError')
    return 'Camera capture isn’t available in this browser. Open PushPVP in your device’s main browser.';
  if (name === 'NotFoundError')
    return 'No camera is available. Connect or enable one, then try again.';
  if (name === 'OverconstrainedError')
    return 'The selected camera or camera settings aren’t available. Choose another camera or reconnect it, then try again.';
  if (name === 'NotReadableError')
    return 'The camera couldn’t be opened. Close other apps or tabs using it, then try again.';
  if (name === 'AbortError' || name === 'InvalidStateError')
    return 'Camera startup was interrupted. Return to the PushPVP tab and try again.';
  return 'We could not start your camera. Check browser camera settings and try again.';
}

export async function enumerateBrowserVideoDevices(): Promise<BrowserVideoDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }));
}
