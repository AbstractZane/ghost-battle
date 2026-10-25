import type { PoseLandmark, PoseLandmarkName } from './poseTypes';

export const SKELETON_EDGES: ReadonlyArray<readonly [PoseLandmarkName, PoseLandmarkName]> = [
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['leftShoulder', 'rightShoulder'],
  ['leftHip', 'rightHip'],
];

export const LANDMARK_LABELS: Partial<Record<PoseLandmarkName, string>> = {
  leftShoulder: 'LS',
  leftElbow: 'LE',
  leftWrist: 'LW',
  rightShoulder: 'RS',
  rightElbow: 'RE',
  rightWrist: 'RW',
  leftHip: 'LH',
  rightHip: 'RH',
  leftKnee: 'LK',
  rightKnee: 'RK',
  leftAnkle: 'LA',
  rightAnkle: 'RA',
};

export interface PreviewProjection {
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  displayMirrored: boolean;
  resizeMode?: 'cover' | 'contain';
}

/** Projects canonical exercise coordinates through the preview's cover or contain transform. */
export function projectLandmarkToPreview(
  landmark: Pick<PoseLandmark, 'x' | 'y'>,
  projection: PreviewProjection,
): { x: number; y: number } {
  if (
    projection.sourceWidth <= 0 ||
    projection.sourceHeight <= 0 ||
    projection.viewportWidth <= 0 ||
    projection.viewportHeight <= 0
  ) {
    return { x: 0, y: 0 };
  }
  const scales = [
    projection.viewportWidth / projection.sourceWidth,
    projection.viewportHeight / projection.sourceHeight,
  ];
  const scale = projection.resizeMode === 'contain' ? Math.min(...scales) : Math.max(...scales);
  const renderedWidth = projection.sourceWidth * scale;
  const renderedHeight = projection.sourceHeight * scale;
  const offsetX = (projection.viewportWidth - renderedWidth) / 2;
  const offsetY = (projection.viewportHeight - renderedHeight) / 2;
  const geometryScale = Math.max(projection.sourceWidth, projection.sourceHeight);
  const sourceNormalizedX = (landmark.x * geometryScale) / projection.sourceWidth;
  const sourceNormalizedY = (landmark.y * geometryScale) / projection.sourceHeight;
  const normalizedX = projection.displayMirrored ? 1 - sourceNormalizedX : sourceNormalizedX;
  return {
    x: offsetX + normalizedX * renderedWidth,
    y: offsetY + sourceNormalizedY * renderedHeight,
  };
}
