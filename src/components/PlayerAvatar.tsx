import React from 'react';
import { View } from 'react-native';
import { PixelPortrait } from '@/shop/CosmeticArtwork';
export function PlayerAvatar({
  name,
  size = 48,
}: {
  name: string;
  size?: number;
  pixelPortrait?: boolean;
}) {
  return (
    <View
      accessibilityLabel={`${name} profile picture`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: '#25233B',
      }}
    >
      <PixelPortrait size={size} />
    </View>
  );
}
