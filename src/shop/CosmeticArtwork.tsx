import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import { frameValues, pixelFrameIds } from './cosmeticVisuals';

// Original artwork, authored for PushPVP. Integer grids preserve the pixel silhouette.
const hats: Record<string, { rows: string[]; palette: Record<string, string> }> = {
  forge_crown: {
    palette: { g: '#F7CD68', l: '#FFF1B6', s: '#B97138', v: '#AD7DFF', w: '#E3C9FF' },
    rows: [
      '..gg........gg........gg..',
      '..glg......gllg......glg..',
      '..glgg....ggllgg....gglg..',
      '..gllgg..ggllllgg..ggllg..',
      '..glllggggllllllgggglllg..',
      '..glllllllllllllllllllg..',
      '..glllvvllllvvllllvvllg..',
      '..gllvwvlllvwvlllvwvllg..',
      '..glllvvllllvvllllvvllg..',
      '..ggggggggggggggggggggg..',
      '...sssssssssssssssssss...',
    ],
  },
  moon_wizard: {
    palette: { v: '#8E60DD', l: '#C9A0FF', d: '#493174', g: '#FFE5A1', w: '#F9F0FF' },
    rows: [
      '.................ll.....',
      '..............lllv......',
      '............llvvv.......',
      '..........llvvvvv.......',
      '.........lvvvvvvv.......',
      '........lvvggvvvvv......',
      '.......lvvggvvvvvvv.....',
      '......lvvvvggvvvvvvv....',
      '.....lvvvvvvvvvvvvvvv...',
      '....lvvvvvwvvvvvvvvvvv..',
      '...lvvvvvwwwvvvvvvvvvvv.',
      '..dddddddddddddddddddd..',
      'llllllllllllllllllllllll',
      '.vvvvvvvvvvvvvvvvvvvvvv.',
    ],
  },
  sprout_cap: {
    palette: { g: '#5FCE96', l: '#BBFFD0', d: '#287860', m: '#E4D6B2', s: '#A58E75' },
    rows: [
      '.......lll......lll.....',
      '......lgggl....lgggl....',
      '.......lgggl..lgggl.....',
      '........lgggllgggl......',
      '.........lggggggl.......',
      '...........gggg.........',
      '...........gg...........',
      '......mmmmmmmmmmmm......',
      '....mmllllllllllllmm....',
      '...mllggggggggggggllm...',
      '..mllggggggggggggggllm..',
      '..mllggggggggggggggllm..',
      '.dddddddddddddddddddddd.',
      '..ssssssssssssssssssss..',
    ],
  },
  ember_fox: {
    palette: { o: '#F4A263', l: '#FFD7A0', d: '#A95545', w: '#FFF1DF', p: '#F5AAAB' },
    rows: [
      '..oo................oo..',
      '..olo..............olo..',
      '..olwo............owlo..',
      '..olwwo..........owwlo..',
      '..olpwwo........owwplo..',
      '..olppwwoooooooowwpplo..',
      '..olpppwwllllllwwppplo..',
      '..oolllllllllllllllloo..',
      '...ollllllllllllllllo...',
      '..ollllllllllllllllllo..',
      '.ollllllllllllllllllllo.',
      'dddddddddddddddddddddddd',
    ],
  },
};

function PixelHat({ id, size }: { id: string; size: number }) {
  const art = hats[id];
  if (!art) return null;
  return (
    <Svg width={size} height={size * 0.62} viewBox="0 0 26 16" accessibilityElementsHidden>
      {art.rows.flatMap((row, y) =>
        [...row].map((color, x) =>
          color === '.' ? null : (
            <Rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={art.palette[color]} />
          ),
        ),
      )}
    </Svg>
  );
}

export function AvatarHat({
  id,
  size,
  phase,
  moving,
}: {
  id: string;
  size: number;
  phase: Animated.Value;
  moving: boolean;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.hat,
        {
          width: size * 1.2,
          height: size * 0.75,
          left: -size * 0.1,
          top: -size * 0.42,
          transform: moving
            ? [
                {
                  translateY: phase.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0, -size * 0.045, 0],
                  }),
                },
                {
                  rotate: phase.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: ['-3deg', '3deg', '-3deg'],
                  }),
                },
              ]
            : [],
        },
      ]}
    >
      <PixelHat id={id} size={size * 1.2} />
      {id === 'moon_wizard' ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: -size * 0.04,
            right: -size * 0.02,
            opacity: moving
              ? phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 1, 0.3] })
              : 1,
          }}
        >
          <Svg width={size * 0.22} height={size * 0.22} viewBox="0 0 12 12">
            <Path d="M5 0h2v4h4v2H7v4H5V6H1V4h4z" fill="#FFE5A1" />
          </Svg>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export function AvatarFrame({
  id,
  size,
  phase,
  moving,
}: {
  id: string;
  size: number;
  phase: Animated.Value;
  moving: boolean;
}) {
  const accent = frameValues[id];
  if (!accent) return null;
  const pixel = pixelFrameIds.has(id);
  const rotation = moving
    ? phase.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
    : '0deg';
  const animated = [
    'diamond_orbit',
    'prism_shine',
    'crystal_pulse',
    'solar_flare',
    'void_portal',
    'neon_current',
  ].includes(id);
  const extent = size * 1.22;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: extent,
        height: extent,
        top: -size * 0.11,
        left: -size * 0.11,
      }}
    >
      <Svg width={extent} height={extent} viewBox="0 0 100 100" accessibilityElementsHidden>
        {pixel ? (
          <>
            <Path
              d="M24 7H76V13H87V24H93V76H87V87H76V93H24V87H13V76H7V24H13V13H24Z"
              fill="none"
              stroke="#201831"
              strokeWidth={10}
            />
            <Path
              d="M24 7H76V13H87V24H93V76H87V87H76V93H24V87H13V76H7V24H13V13H24Z"
              fill="none"
              stroke={accent}
              strokeWidth={4}
            />
            <Path
              d="M27 12H73M88 27V73M73 88H27M12 73V27"
              stroke={id === 'sunset_pixels' ? '#E995DC' : '#E4FFF2'}
              strokeWidth={3}
            />
            {(
              [
                [15, 15],
                [80, 15],
                [15, 80],
                [80, 80],
              ] as const
            ).map(([x, y], i) => (
              <G key={i}>
                <Rect
                  x={x}
                  y={y}
                  width={6}
                  height={6}
                  fill={id === 'bloom_byte' ? '#FF7BBC' : accent}
                />
                <Rect x={x + 2} y={y + 2} width={2} height={2} fill="#FFEDB8" />
              </G>
            ))}
          </>
        ) : (
          <>
            <Circle
              cx={50}
              cy={50}
              r={43}
              fill="none"
              stroke={accent}
              strokeWidth={2}
              opacity={0.4}
            />
            <Circle
              cx={50}
              cy={50}
              r={47}
              fill="none"
              stroke={accent}
              strokeWidth={1}
              strokeDasharray={id === 'onyx_ring' ? '2 5' : '12 8'}
            />
            {!animated
              ? [0, 90, 180, 270].map((angle) => (
                  <Polygon
                    key={angle}
                    points="50,0 55,9 50,16 45,9"
                    fill={accent}
                    transform={`rotate(${angle} 50 50)`}
                  />
                ))
              : null}
            {id === 'amethyst_edge' ? (
              <Path
                d="M6 27L0 43L9 53M94 27L100 43L91 53"
                stroke={accent}
                strokeWidth={4}
                fill="none"
              />
            ) : null}
          </>
        )}
      </Svg>
      {animated ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: rotation }] }]}>
          <Svg width={extent} height={extent} viewBox="0 0 100 100">
            {id === 'prism_shine'
              ? ['#FFA3D7', '#FFE5A1', '#91F7BD', '#92EEFF', '#BD92FF', '#FFA3D7'].map(
                  (color, i) => (
                    <Path
                      key={color + i}
                      d="M50 4A46 46 0 0 1 89.8 27"
                      stroke={color}
                      strokeWidth={5}
                      strokeLinecap="round"
                      fill="none"
                      transform={`rotate(${i * 60} 50 50)`}
                    />
                  ),
                )
              : null}
            {id === 'void_portal'
              ? [0, 90, 180, 270].map((angle) => (
                  <Path
                    key={angle}
                    d="M27 3H42V8H27V15H20"
                    fill="none"
                    stroke="#E8CEFF"
                    strokeWidth={4}
                    transform={`rotate(${angle} 50 50)`}
                  />
                ))
              : null}
            {id === 'solar_flare'
              ? Array.from({ length: 12 }, (_, i) => (
                  <Polygon
                    key={i}
                    points="50,0 54,13 50,8 46,13"
                    fill={i % 2 ? '#FF785D' : '#FFE4A1'}
                    transform={`rotate(${i * 30} 50 50)`}
                  />
                ))
              : null}
            {id === 'neon_current'
              ? [0, 120, 240].map((angle) => (
                  <Path
                    key={angle}
                    d="M50 3L63 5L60 10L73 12L70 17L84 22"
                    stroke="#B6FFD5"
                    strokeWidth={3}
                    fill="none"
                    transform={`rotate(${angle} 50 50)`}
                  />
                ))
              : null}
            {id === 'diamond_orbit' || id === 'crystal_pulse'
              ? [0, 180].map((angle) => (
                  <G key={angle} transform={`rotate(${angle} 50 50)`}>
                    <Polygon
                      points="50,0 56,7 50,15 44,7"
                      fill="#AD8AFF"
                      stroke="#DFFFFF"
                      strokeWidth={1.5}
                    />
                    <Path d="M45 7h10M50 1v13" stroke={accent} />
                    <Circle cx={39} cy={5} r={2} fill={accent} opacity={0.7} />
                    <Circle cx={31} cy={9} r={1} fill={accent} opacity={0.4} />
                  </G>
                ))
              : null}
          </Svg>
        </Animated.View>
      ) : null}
      {id === 'crystal_pulse' ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: extent / 2,
              borderWidth: 2,
              borderColor: accent,
              opacity: moving
                ? phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.1, 0.6, 0.1] })
                : 0.25,
              transform: [
                {
                  scale: moving
                    ? phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] })
                    : 1,
                },
              ],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export function PixelPortrait({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityElementsHidden>
      <Rect width={32} height={32} fill="#191A31" />
      <Path d="M8 10H24V13H27V25H24V28H8V25H5V13H8Z" fill="#7771A8" />
      <Path d="M10 10H22V13H25V23H22V26H10V23H7V13H10Z" fill="#D2CCE8" />
      <Path d="M9 16H23V22H9Z" fill="#30304C" />
      <Path d="M11 17H14V20H11ZM18 17H21V20H18Z" fill="#91F7BD" />
      <Path d="M11 26H21V29H24V32H8V29H11Z" fill="#7467A6" />
      <Rect x={14} y={23} width={4} height={1} fill="#8F7AAB" />
    </Svg>
  );
}
const styles = StyleSheet.create({ hat: { position: 'absolute', zIndex: 3 } });
