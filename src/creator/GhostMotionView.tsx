import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { motionAt, type GhostMotionTrack } from './ghostMotion';
const LINKS = [
  [0, 1],
  [0, 2],
  [2, 4],
  [1, 3],
  [3, 5],
  [0, 6],
  [1, 7],
  [6, 7],
  [6, 8],
  [8, 10],
  [7, 9],
  [9, 11],
] as const;
/** Body-only motion; never fabricates a rep, face landmark, or missing limb. */
export const GhostMotionView = React.memo(function GhostMotionView({
  track,
  atMs,
  score = 0,
}: {
  track: GhostMotionTrack;
  atMs: number;
  score?: number;
}) {
  const joints = motionAt(track, atMs);
  const left = joints[0],
    right = joints[1];
  const shoulderSpan = left && right ? Math.hypot(left[0] - right[0], left[1] - right[1]) : 0;
  const head =
    left && right
      ? [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2 - Math.max(250, shoulderSpan * 0.65)]
      : null;
  const visible = joints.some(Boolean);
  const w = track.aspectRatio >= 1 ? 10000 : track.aspectRatio * 10000;
  const h = track.aspectRatio >= 1 ? 10000 / track.aspectRatio : 10000;
  return (
    <View style={styles.root} accessibilityLabel={`Motion ghost, ${score} reps`}>
      <Svg width="100%" height="100%" viewBox={`-700 -700 ${w + 1400} ${h + 1400}`}>
        <Defs>
          <LinearGradient id="ghost-floor" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#182C3D" />
            <Stop offset="1" stopColor="#251A42" />
          </LinearGradient>
        </Defs>
        <Rect x={-700} y={-700} width={w + 1400} height={h + 1400} fill="url(#ghost-floor)" />
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <Line
            key={p}
            x1={0}
            y1={h * p}
            x2={w}
            y2={h * p}
            stroke="#35415C"
            strokeWidth={8}
            opacity={0.5}
          />
        ))}
        {LINKS.map(([a, b]) => {
          const p = joints[a],
            q = joints[b];
          return p && q ? (
            <React.Fragment key={`${a}:${b}`}>
              <Line
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                stroke="#9560F2"
                strokeWidth={160}
                strokeLinecap="round"
                opacity={0.16}
              />
              <Line
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                stroke="#D2BCFF"
                strokeWidth={45}
                strokeLinecap="round"
                opacity={Math.min(p[2], q[2]) / 1000}
              />
            </React.Fragment>
          ) : null;
        })}
        {joints.map((p, i) =>
          p ? (
            <Circle key={i} cx={p[0]} cy={p[1]} r={55} fill="#D9FFF1" opacity={p[2] / 1000} />
          ) : null,
        )}
        {head ? (
          <Circle
            cx={head[0]}
            cy={head[1]}
            r={Math.max(150, shoulderSpan * 0.3)}
            stroke="#D2BCFF"
            strokeWidth={40}
            fill="#AC89E52B"
          />
        ) : null}
      </Svg>
      {!visible ? (
        <View style={styles.status}>
          <Text style={styles.statusText}>TRACKING GAP · MOTION UNAVAILABLE</Text>
        </View>
      ) : null}
      <Text style={styles.label}>GHOST VISION · RECORDED MOVEMENT</Text>
    </View>
  );
});
const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#101529' },
  status: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: { color: '#C8B7EA', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  label: {
    position: 'absolute',
    left: 14,
    top: 12,
    color: '#BCA2EC',
    fontSize: 8,
    letterSpacing: 1.2,
    fontWeight: '800',
  },
});
