import type { PoseLandmark, PoseLandmarkName, PoseResult } from '@/pose/poseTypes';
import { calculateAngle } from '@/pose/poseMath';
import { poseAt } from '@/tests/poseFixtures';

export interface PushupReplayFixtureV5 {
  name: string;
  expectedReps: number;
  frames: PoseResult[];
}

function clonePose(pose: PoseResult): PoseResult {
  const landmarks = Object.fromEntries(
    Object.entries(pose.landmarks).map(([name, landmark]) => [
      name,
      landmark ? { ...landmark } : landmark,
    ]),
  ) as PoseResult['landmarks'];
  return { ...pose, landmarks, rawLandmarks: landmarks };
}

function setConfidence(
  pose: PoseResult,
  names: ReadonlyArray<PoseLandmarkName>,
  confidence: number,
): PoseResult {
  const next = clonePose(pose);
  for (const name of names) {
    const landmark = next.landmarks[name];
    if (landmark) landmark.confidence = confidence;
  }
  return next;
}

function transformPose(
  pose: PoseResult,
  transform: (landmark: PoseLandmark, name: PoseLandmarkName) => PoseLandmark,
): PoseResult {
  const next = clonePose(pose);
  for (const [name, landmark] of Object.entries(next.landmarks)) {
    if (landmark)
      next.landmarks[name as PoseLandmarkName] = transform(landmark, name as PoseLandmarkName);
  }
  next.rawLandmarks = next.landmarks;
  return next;
}

function topHold(start: number, interval = 80, duration = 560): PoseResult[] {
  const frames: PoseResult[] = [];
  for (let offset = 0; offset <= duration; offset += interval) {
    frames.push(poseAt(166, start + offset));
  }
  return frames;
}

function repCycle(start: number, interval = 70): PoseResult[] {
  const angles = [150, 142, 135, 118, 96, 88, 84, 86, 88, 100, 112, 126, 144, 156, 165, 166];
  return angles.map((angle, index) => poseAt(angle, start + index * interval));
}

export function validPushupsV5(count: number, interval = 70): PoseResult[] {
  const frames = topHold(0);
  let timestamp = frames.at(-1)?.timestamp ?? 0;
  for (let rep = 0; rep < count; rep += 1) {
    const cycle = repCycle(timestamp + interval, interval);
    frames.push(...cycle);
    timestamp = cycle.at(-1)?.timestamp ?? timestamp;
    frames.push(poseAt(166, timestamp + interval));
    timestamp += interval;
  }
  return frames;
}

function standing(frames: PoseResult[]): PoseResult[] {
  return frames.map((pose) =>
    transformPose(pose, (landmark) => ({
      ...landmark,
      x: 0.5 - (landmark.y - 0.5),
      y: 0.5 + (landmark.x - 0.5),
    })),
  );
}

function scale(frames: PoseResult[], factor: number): PoseResult[] {
  return frames.map((pose) =>
    transformPose(pose, (landmark) => ({
      ...landmark,
      x: 0.5 + (landmark.x - 0.5) * factor,
      y: 0.5 + (landmark.y - 0.5) * factor,
    })),
  );
}

const LEFT_SIDE: ReadonlyArray<PoseLandmarkName> = [
  'leftShoulder',
  'leftElbow',
  'leftWrist',
  'leftHip',
  'leftKnee',
  'leftAnkle',
];

export function pushupReplayFixturesV5(): PushupReplayFixtureV5[] {
  const cleanFive = validPushupsV5(5);
  const wristDropout = validPushupsV5(1).map((pose, index) =>
    index === 12 || index === 13 ? setConfidence(pose, ['leftWrist'], 0.03) : pose,
  );
  const ankleDropout = validPushupsV5(1).map((pose, index) =>
    index === 10 || index === 11 ? setConfidence(pose, ['leftAnkle'], 0.03) : pose,
  );
  const confidenceNoise = validPushupsV5(1).map((pose, index) =>
    transformPose(pose, (landmark, name) => ({
      ...landmark,
      confidence:
        name.startsWith('left') && index % 5 === 2
          ? Math.max(0.2, landmark.confidence - 0.55)
          : landmark.confidence,
    })),
  );
  const briefJitter = validPushupsV5(1).map((pose, index) =>
    transformPose(pose, (landmark, name) => ({
      ...landmark,
      x: landmark.x + ((index + name.length) % 3 === 0 ? 0.006 : -0.004),
      y: landmark.y + ((index + name.length) % 4 === 0 ? 0.005 : -0.003),
    })),
  );
  const normalTorsoMotion = validPushupsV5(1).map((pose, index) =>
    index < 9 || index > 21
      ? pose
      : transformPose(pose, (landmark) => ({
          ...landmark,
          x: landmark.x + (index % 2 === 0 ? 0.018 : -0.018),
        })),
  );
  const partial = [
    ...topHold(0),
    ...[150, 143, 136, 128, 122, 130, 142, 156, 166, 166].map((angle, index) =>
      poseAt(angle, 640 + index * 80),
    ),
  ];
  const partial145 = [
    ...topHold(0),
    ...[150, 145, 142, 140, 143, 145, 150, 160, 166].map((angle, index) =>
      poseAt(angle, 640 + index * 80),
    ),
  ];
  const bottomJitter = [
    ...topHold(0),
    ...[145, 136, 96, 91, 94, 89, 93, 90, 95, 130, 166, 166].map((angle, index) =>
      poseAt(angle, 640 + index * 60),
    ),
  ];
  const topJitter = [
    ...topHold(0),
    ...[146, 143, 147, 142, 148, 144, 150, 166].map((angle, index) =>
      poseAt(angle, 640 + index * 70),
    ),
  ];
  const impossible = [
    ...topHold(0),
    ...[140, 82, 115, 166, 166].map((angle, index) => poseAt(angle, 640 + index * 30)),
  ];
  const oneFrameBottomSpike = [
    ...topHold(0),
    ...[145, 136, 82, 116, 132, 165, 166].map((angle, index) => poseAt(angle, 640 + index * 80)),
  ];
  const rapidButPlausibleSpike = [
    ...topHold(0),
    poseAt(140, 640),
    poseAt(82, 720),
    poseAt(115, 800),
    poseAt(165, 880),
  ];
  const halfway = [
    ...Array.from({ length: 8 }, (_, index) => poseAt(120, index * 80)),
    ...[130, 145, 160, 166, 166, 166].map((angle, index) => poseAt(angle, 720 + index * 80)),
  ];
  const noReturn = [
    ...topHold(0),
    ...[145, 135, 100, 88, 84, 86, 110, 125, 140, 148].map((angle, index) =>
      poseAt(angle, 640 + index * 80),
    ),
  ];
  const standingFlex = standing([...topHold(0), ...repCycle(640)]);
  const walkIn = [...standing(topHold(0, 80, 320)), ...topHold(400, 80, 240), ...repCycle(720)];
  const kneeling = validPushupsV5(1).map((pose) =>
    poseAt(
      calculateAngle(
        pose.landmarks.leftShoulder,
        pose.landmarks.leftElbow,
        pose.landmarks.leftWrist,
      ) ?? 166,
      pose.timestamp,
      { kneeAngle: 90 },
    ),
  );
  const cameraShake = validPushupsV5(1).map((pose, index) =>
    index < 8
      ? pose
      : transformPose(pose, (landmark) => ({
          ...landmark,
          x: landmark.x + (index % 2 === 0 ? 0.11 : -0.11),
        })),
  );
  const temporarySideLoss = validPushupsV5(1).map((pose, index) =>
    index >= 11 && index <= 13 ? setConfidence(pose, LEFT_SIDE, 0.05) : pose,
  );
  const crossSideArtifact = [
    ...topHold(0),
    poseAt(145, 640, { leftElbowAngle: 145, rightElbowAngle: 166 }),
    poseAt(136, 720, { leftElbowAngle: 136, rightElbowAngle: 166 }),
    ...[82, 84, 116, 128, 165, 166].map((rightAngle, index) =>
      poseAt(rightAngle, 800 + index * 90, {
        preferredSide: 'right',
        leftElbowAngle: 136,
        rightElbowAngle: rightAngle,
        landmarkConfidence: {
          leftShoulder: 0.03,
          leftElbow: 0.03,
          leftWrist: 0.03,
          leftHip: 0.03,
        },
      }),
    ),
  ];
  const bothSidesPoor = topHold(0).map((pose) =>
    setConfidence(
      pose,
      [...LEFT_SIDE, ...LEFT_SIDE.map((name) => name.replace('left', 'right') as PoseLandmarkName)],
      0.05,
    ),
  );
  const randomNoise = Array.from({ length: 30 }, (_, index) =>
    transformPose(poseAt(120 + ((index * 47) % 55), index * 60), (landmark, name) => ({
      ...landmark,
      x: ((index * 17 + name.length * 7) % 100) / 100,
      y: ((index * 29 + name.length * 11) % 100) / 100,
      confidence: ((index * 13 + name.length) % 50) / 100,
    })),
  );

  return [
    { name: '1 perfect pushup', expectedReps: 1, frames: validPushupsV5(1) },
    { name: '5 normal pushups', expectedReps: 5, frames: cleanFive },
    { name: 'slow pushup', expectedReps: 1, frames: validPushupsV5(1, 180) },
    { name: 'fast valid pushup', expectedReps: 1, frames: validPushupsV5(1, 60) },
    { name: 'confidence noise', expectedReps: 1, frames: confidenceNoise },
    { name: 'temporary wrist dropout', expectedReps: 1, frames: wristDropout },
    { name: 'temporary ankle dropout', expectedReps: 1, frames: ankleDropout },
    { name: 'brief keypoint jitter', expectedReps: 1, frames: briefJitter },
    { name: 'normal torso motion during rep', expectedReps: 1, frames: normalTorsoMotion },
    { name: 'half rep', expectedReps: 0, frames: partial },
    { name: '140-145 partial depth', expectedReps: 0, frames: partial145 },
    { name: 'elbow flex while standing', expectedReps: 0, frames: standingFlex },
    { name: 'user walks into frame', expectedReps: 0, frames: walkIn },
    { name: 'kneeling repositioning', expectedReps: 0, frames: kneeling },
    { name: 'camera shake during motion', expectedReps: 0, frames: cameraShake },
    { name: 'starts halfway down', expectedReps: 0, frames: halfway },
    { name: 'never returns to top', expectedReps: 0, frames: noReturn },
    { name: 'bottom threshold jitter', expectedReps: 0, frames: bottomJitter },
    { name: 'top threshold jitter', expectedReps: 0, frames: topJitter },
    { name: 'impossible 150ms rep', expectedReps: 0, frames: impossible },
    { name: 'one-frame bottom spike', expectedReps: 0, frames: oneFrameBottomSpike },
    { name: 'rapid 240ms spike', expectedReps: 0, frames: rapidButPlausibleSpike },
    { name: 'temporary active-side loss', expectedReps: 1, frames: temporarySideLoss },
    { name: 'cross-side motion artifact', expectedReps: 0, frames: crossSideArtifact },
    { name: 'both sides poor', expectedReps: 0, frames: bothSidesPoor },
    { name: 'random MoveNet noise', expectedReps: 0, frames: randomNoise },
    { name: 'person too close', expectedReps: 0, frames: scale(topHold(0), 1.35) },
    { name: 'person too far', expectedReps: 0, frames: scale(topHold(0), 0.2) },
  ];
}
