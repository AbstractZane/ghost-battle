import React, { useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';
import { LANDMARK_LABELS, projectLandmarkToPreview, SKELETON_EDGES } from '@/pose/poseProjection';
import type { PoseLandmarkName, PoseLandmarks } from '@/pose/poseTypes';

interface SkeletonOverlayProps {
  landmarks: PoseLandmarks;
  displayMirrored: boolean;
  sourceWidth: number;
  sourceHeight: number;
  minimumConfidence?: number;
  showLabels?: boolean;
  showConfidence?: boolean;
  resizeMode?: 'cover' | 'contain';
}

export function SkeletonOverlay({
  landmarks,
  displayMirrored,
  sourceWidth,
  sourceHeight,
  minimumConfidence = 0.12,
  showLabels = false,
  showConfidence = false,
  resizeMode = Platform.OS === 'web' ? 'contain' : 'cover',
}: SkeletonOverlayProps) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => setViewport(event.nativeEvent.layout);
  const point = (name: PoseLandmarkName) => {
    const landmark = landmarks[name];
    if (!landmark || landmark.confidence < minimumConfidence) return null;
    return {
      ...landmark,
      ...projectLandmarkToPreview(landmark, {
        sourceWidth,
        sourceHeight,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        displayMirrored,
        resizeMode,
      }),
    };
  };

  return (
    <View
      pointerEvents="none"
      collapsable={false}
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
    >
      {viewport.width > 0 && viewport.height > 0 ? (
        <Svg pointerEvents="none" width={viewport.width} height={viewport.height}>
          {SKELETON_EDGES.map(([startName, endName]) => {
            const start = point(startName);
            const end = point(endName);
            return start && end ? (
              <Line
                key={`${startName}-${endName}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={colors.primary}
                strokeOpacity={Math.max(0.2, Math.min(start.confidence, end.confidence))}
                strokeWidth={Math.max(viewport.width, viewport.height) * 0.008}
              />
            ) : null;
          })}
          {(Object.keys(landmarks) as PoseLandmarkName[]).map((name) => {
            const landmark = point(name);
            return landmark ? (
              <Circle
                key={name}
                cx={landmark.x}
                cy={landmark.y}
                r={Math.max(viewport.width, viewport.height) * 0.012}
                fill={colors.cyan}
                fillOpacity={Math.max(0.2, landmark.confidence)}
              />
            ) : null;
          })}
          {showLabels
            ? (Object.keys(LANDMARK_LABELS) as PoseLandmarkName[]).map((name) => {
                const landmark = point(name);
                return landmark ? (
                  <SvgText
                    key={`label-${name}`}
                    x={landmark.x + 5}
                    y={landmark.y - 5}
                    fill={name.startsWith('left') ? colors.cyan : colors.primary}
                    fontSize={11}
                    fontWeight="bold"
                  >
                    {LANDMARK_LABELS[name]}
                    {showConfidence ? ` ${landmark.confidence.toFixed(2)}` : ''}
                  </SvgText>
                ) : null;
              })
            : null}
        </Svg>
      ) : null}
    </View>
  );
}
