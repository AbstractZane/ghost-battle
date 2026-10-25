import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRankAnimation } from '@/components/useRankAnimation';

const shown = new Set<string>();
const COLORS = ['#CEFF91', '#FFE5A0', '#BCA0FF', '#FFFFFF'];
/** Decoration only: the caller must have observed this round running, then a confirmed win. */
export function MatchVictoryCelebration({
  identity,
  eligible,
}: {
  identity: string;
  eligible: boolean;
}) {
  const allowed = useRef(eligible && !shown.has(identity)).current;
  const { width, height } = useWindowDimensions();
  const { progress, playing } = useRankAnimation(1850, identity);
  useEffect(() => {
    if (allowed) {
      shown.add(identity);
      if (shown.size > 250) shown.delete(shown.values().next().value!);
    }
  }, [allowed, identity]);
  if (!allowed || !playing) return null;
  const fontSize = Math.min(92, width * 0.145);
  const titleStyle = [styles.word, { fontSize }];
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.clip]}
      testID="match-victory-celebration"
    >
      {/* One soft impact bloom, never a repeated flash. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.bloom,
          {
            opacity: progress.interpolate({
              inputRange: [0, 0.1, 0.17, 0.36, 1],
              outputRange: [0, 0, 0.13, 0, 0],
            }),
          },
        ]}
      />
      {Array.from({ length: 10 }, (_, i) => (
        <Animated.View
          key={`wind-${i}`}
          style={[
            styles.speedLine,
            {
              top: height * 0.3 + (i - 5) * 24,
              width: width * (0.22 + (i % 3) * 0.11),
              height: i % 3 === 0 ? 2 : 1,
              backgroundColor: COLORS[i % 4],
              opacity: progress.interpolate({
                inputRange: [0, 0.07 + i * 0.009, 0.22 + i * 0.009, 0.56, 1],
                outputRange: [0, 0, 0.65, 0, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [-width * 1.2 - i * 35, width * 1.1, width * 2],
                  }),
                },
                { rotate: '-7deg' },
              ],
            },
          ]}
        />
      ))}
      <Animated.View
        style={[
          styles.sweep,
          {
            opacity: progress.interpolate({
              inputRange: [0, 0.08, 0.69, 0.93, 1],
              outputRange: [0, 1, 1, 0, 0],
            }),
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 0.18, 0.24, 0.64, 0.76, 1],
                  outputRange: [-width * 1.25, 16, -5, 5, 36, width * 1.35],
                }),
              },
              {
                scale: progress.interpolate({
                  inputRange: [0, 0.18, 0.26, 0.66, 1],
                  outputRange: [0.94, 1.055, 1, 1.015, 1.06],
                }),
              },
              { rotate: '-5deg' },
            ],
          },
        ]}
      >
        <View style={styles.trailTop} />
        <View style={styles.trailBottom} />
        <View style={styles.bandInset} />
        <Text style={styles.kicker}>M A T C H W O N</Text>
        <View>
          <Animated.Text
            style={[
              ...titleStyle,
              styles.echo,
              styles.echoViolet,
              {
                opacity: progress.interpolate({
                  inputRange: [0, 0.12, 0.3, 0.68, 0.82, 1],
                  outputRange: [0, 0.65, 0, 0, 0.6, 0],
                }),
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 0.24, 0.65, 1],
                      outputRange: [-68, -3, -3, -90],
                    }),
                  },
                ],
              },
            ]}
          >
            VICTORY
          </Animated.Text>
          <Text style={[...titleStyle, styles.echo, styles.extrusion]}>VICTORY</Text>
          <Text style={titleStyle}>VICTORY</Text>
        </View>
        <View style={styles.underline}>
          <View style={styles.underlineCore} />
        </View>
        {/* A moving specular highlight gives the title a sharp finish. */}
        <Animated.View
          style={[
            styles.glint,
            {
              opacity: progress.interpolate({
                inputRange: [0, 0.27, 0.33, 0.52, 0.58, 1],
                outputRange: [0, 0, 0.85, 0.85, 0, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 0.28, 0.57, 1],
                    outputRange: [-width, -width * 0.6, width * 0.6, width],
                  }),
                },
                { rotate: '22deg' },
              ],
            },
          ]}
        />
      </Animated.View>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        return (
          <Animated.View
            key={`spark-${i}`}
            style={[
              styles.burstOrigin,
              {
                top: height * 0.34,
                left: width / 2,
                opacity: progress.interpolate({
                  inputRange: [0, 0.14, 0.19, 0.55, 1],
                  outputRange: [0, 0, 1, 0, 0],
                }),
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 0.16, 0.6, 1],
                      outputRange: [
                        0,
                        0,
                        Math.cos(angle) * Math.min(width * 0.48, 340),
                        Math.cos(angle) * width * 0.6,
                      ],
                    }),
                  },
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 0.16, 0.6, 1],
                      outputRange: [0, 0, Math.sin(angle) * 150, Math.sin(angle) * 190],
                    }),
                  },
                  {
                    scale: progress.interpolate({
                      inputRange: [0, 0.17, 0.25, 0.6, 1],
                      outputRange: [0, 0.4, 1, 0.1, 0],
                    }),
                  },
                  { rotate: `${i * 27}deg` },
                ],
              },
            ]}
          >
            <View style={styles.starHorizontal} />
            <View style={styles.starVertical} />
          </Animated.View>
        );
      })}
      {Array.from({ length: width < 600 ? 28 : 44 }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const spread = width * (0.16 + (i % 11) * 0.039) * side;
        return (
          <Animated.View
            key={`confetti-${i}`}
            style={[
              styles.confetti,
              {
                backgroundColor: COLORS[i % 4],
                left: width / 2,
                top: height * 0.32,
                width: i % 3 === 0 ? 4 : 7,
                height: i % 2 === 0 ? 13 : 5,
                opacity: progress.interpolate({
                  inputRange: [0, 0.14, 0.2, 0.69, 1],
                  outputRange: [0, 0, 1, 1, 0],
                }),
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 0.15, 0.48, 1],
                      outputRange: [0, 0, spread * 0.8, spread],
                    }),
                  },
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 0.15, 0.4, 0.65, 1],
                      outputRange: [0, 0, -55 - (i % 7) * 17, (i % 5) * 25, height * 0.56],
                    }),
                  },
                  {
                    rotate: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [`${i * 31}deg`, `${i * 31 + side * 570}deg`],
                    }),
                  },
                  {
                    scaleX: progress.interpolate({
                      inputRange: [0, 0.3, 0.5, 0.7, 1],
                      outputRange: [1, 0.35, 1, 0.3, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  bloom: { backgroundColor: '#E4FFC1' },
  speedLine: { position: 'absolute', left: 0, borderRadius: 2 },
  sweep: {
    position: 'absolute',
    top: '26%',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    backgroundColor: 'rgba(16,23,22,.97)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#90B870',
    shadowColor: '#B9FF80',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    overflow: 'hidden',
  },
  bandInset: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 7,
    bottom: 7,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(205,255,147,.12)',
  },
  kicker: { color: '#FFE4A2', fontSize: 10, fontWeight: '800', marginBottom: 1 },
  word: {
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 5,
    color: '#F1FFD9',
    textShadowColor: '#A3F469',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  echo: { position: 'absolute', top: 0, left: 0 },
  echoViolet: { color: '#AB80FF', textShadowColor: '#AB80FF' },
  extrusion: { color: '#5D903C', top: 4, left: -3, textShadowRadius: 0 },
  underline: {
    height: 2,
    width: '52%',
    marginTop: 9,
    backgroundColor: 'rgba(194,255,140,.2)',
    alignItems: 'center',
  },
  underlineCore: {
    height: 2,
    width: '35%',
    backgroundColor: '#DAFFA5',
    shadowColor: '#D7FF98',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  trailTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    top: 0,
    backgroundColor: '#E8FFBF',
  },
  trailBottom: {
    position: 'absolute',
    left: '20%',
    right: '10%',
    height: 2,
    bottom: 0,
    backgroundColor: '#DCC0FF',
  },
  glint: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 24,
    backgroundColor: 'rgba(236,255,210,.23)',
    borderLeftWidth: 2,
    borderLeftColor: '#F5FFE3',
  },
  burstOrigin: { position: 'absolute', width: 0, height: 0 },
  starHorizontal: {
    position: 'absolute',
    width: 22,
    height: 2,
    left: -11,
    top: -1,
    backgroundColor: '#FFE9B6',
  },
  starVertical: {
    position: 'absolute',
    width: 2,
    height: 22,
    left: -1,
    top: -11,
    backgroundColor: '#F0FFDE',
  },
  confetti: { position: 'absolute', borderRadius: 1 },
});
