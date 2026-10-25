/** UI-only permission action. No camera frames, device identifiers or model state. */
export interface CameraPermissionAction {
  label: 'ALLOW CAMERA' | 'OPEN CAMERA SETTINGS';
  request(): void;
}
