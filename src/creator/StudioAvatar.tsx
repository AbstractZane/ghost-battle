import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { PlayerAvatar } from '@/components/PlayerAvatar';

export function StudioAvatar({
  name,
  photoUri,
  size = 40,
}: {
  name: string;
  photoUri: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUri]);
  if (!photoUri || failed) return <PlayerAvatar name={name} size={size} pixelPortrait />;
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={{ uri: photoUri }}
        accessibilityLabel={`${name} profile picture`}
        resizeMode="cover"
        resizeMethod="resize"
        onError={() => setFailed(true)}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: 1, borderColor: '#AFA0DD', backgroundColor: '#202437' },
});
