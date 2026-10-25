import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/** Original vector emblem for Ghost Battle; no third-party character artwork. */
export function GhostInsignia({ size = 88 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Ghost Battle emblem">
      <Defs>
        <LinearGradient id="ghost-light" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#D0FFAC" />
          <Stop offset=".45" stopColor="#A9B3FF" />
          <Stop offset="1" stopColor="#9C71F0" />
        </LinearGradient>
      </Defs>
      <Path
        d="M50 4 92 28 92 74 50 97 8 74 8 28Z"
        fill="#151B2E"
        stroke="#413663"
        strokeWidth="2"
      />
      <Path
        d="M29 68V43C29 27 37 19 50 19S71 27 71 43V73L61 66 50 76 39 66 29 73Z"
        fill="url(#ghost-light)"
      />
      <Path d="m36 41 11 5-3 9-8-4Zm28 0-11 5 3 9 8-4Z" fill="#19203B" />
      <Path
        d="m45 61 5-3 5 3M17 48h7M76 48h7M16 57h6M78 57h6"
        fill="none"
        stroke="#BB9AF7"
        strokeWidth="2"
      />
    </Svg>
  );
}
