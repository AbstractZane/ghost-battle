import type {
  PoseLandmarkName,
  PoseLandmarks,
  PoseResult,
  PoseTrackingMetadata,
} from '@/pose/poseTypes';

export function poseAt(
  elbowAngle: number,
  timestamp: number,
  options: {
    bodyAngle?: number;
    kneeAngle?: number;
    confidence?: number;
    preferredSide?: 'left' | 'right';
    missing?: string[];
    leftElbowAngle?: number;
    rightElbowAngle?: number;
    landmarkConfidence?: Partial<Record<PoseLandmarkName, number>>;
    tracking?: PoseTrackingMetadata;
  } = {},
): PoseResult {
  const bodyAngle = options.bodyAngle ?? 172;
  const kneeAngle = options.kneeAngle ?? 180;
  const confidence = options.confidence ?? 0.95;
  const preferredSide = options.preferredSide ?? 'left';
  const shoulder = { x: 0.18, y: 0.48, confidence };
  const elbow = { x: 0.36, y: 0.48, confidence };
  const hip = { x: 0.58, y: 0.48, confidence };
  const bodyRadians = ((180 - bodyAngle) * Math.PI) / 180;
  const knee = {
    x: hip.x + 0.17 * Math.cos(bodyRadians),
    y: hip.y + 0.17 * Math.sin(bodyRadians),
    confidence,
  };
  const lowerLegRadians = bodyRadians + ((180 - kneeAngle) * Math.PI) / 180;
  const ankle = {
    x: knee.x + 0.17 * Math.cos(lowerLegRadians),
    y: knee.y + 0.17 * Math.sin(lowerLegRadians),
    confidence,
  };
  const wristAt = (angle: number) => {
    const radians = ((180 - angle) * Math.PI) / 180;
    return {
      x: elbow.x + 0.18 * Math.cos(radians),
      y: elbow.y + 0.18 * Math.sin(radians),
      confidence,
    };
  };
  const leftWrist = wristAt(options.leftElbowAngle ?? elbowAngle);
  const rightWrist = wristAt(options.rightElbowAngle ?? elbowAngle);
  const lowerConfidence = Math.max(0, confidence - 0.3);
  const landmarks: PoseLandmarks = {
    leftShoulder: {
      ...shoulder,
      confidence: preferredSide === 'left' ? confidence : lowerConfidence,
    },
    leftElbow: { ...elbow, confidence: preferredSide === 'left' ? confidence : lowerConfidence },
    leftWrist: {
      ...leftWrist,
      confidence: preferredSide === 'left' ? confidence : lowerConfidence,
    },
    leftHip: { ...hip, confidence: preferredSide === 'left' ? confidence : lowerConfidence },
    leftKnee: { ...knee, confidence: preferredSide === 'left' ? confidence : lowerConfidence },
    leftAnkle: { ...ankle, confidence: preferredSide === 'left' ? confidence : lowerConfidence },
    rightShoulder: {
      ...shoulder,
      confidence: preferredSide === 'right' ? confidence : lowerConfidence,
    },
    rightElbow: { ...elbow, confidence: preferredSide === 'right' ? confidence : lowerConfidence },
    rightWrist: {
      ...rightWrist,
      confidence: preferredSide === 'right' ? confidence : lowerConfidence,
    },
    rightHip: { ...hip, confidence: preferredSide === 'right' ? confidence : lowerConfidence },
    rightKnee: { ...knee, confidence: preferredSide === 'right' ? confidence : lowerConfidence },
    rightAnkle: { ...ankle, confidence: preferredSide === 'right' ? confidence : lowerConfidence },
  };
  for (const name of options.missing ?? []) {
    const landmark = landmarks[name as keyof PoseLandmarks];
    if (landmark) landmark.confidence = 0.05;
  }
  for (const [name, value] of Object.entries(options.landmarkConfidence ?? {})) {
    const landmark = landmarks[name as PoseLandmarkName];
    if (landmark && value !== undefined) landmark.confidence = value;
  }
  return {
    timestamp,
    landmarks,
    rawLandmarks: landmarks,
    inferenceLatencyMs: 8,
    sourceWidth: 192,
    sourceHeight: 192,
    cameraFacing: 'back',
    orientation: 'up',
    inputMirrored: false,
    displayMirrored: false,
    tracking: options.tracking,
  };
}

export function validRepSequence(
  start = 0,
  options: {
    bodyAngle?: number;
    kneeAngle?: number;
    preferredSide?: 'left' | 'right';
  } = {},
) {
  const frames: Array<[number, number]> = [
    [165, 0],
    [165, 500],
    [140, 620],
    [135, 720],
    [85, 850],
    [85, 950],
    [115, 1080],
    [125, 1180],
    [165, 1320],
    [165, 1420],
  ];
  return frames.map(([angle, offset]) => poseAt(angle, start + offset, options));
}
