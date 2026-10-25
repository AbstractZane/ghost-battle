import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedInteractionMotion } from '@/components/InteractionMotion';
/** A short, score-driven impact. Decorative only; never feeds the race clock or detector. */
export function GhostRepBurst({ score, own = false }: { score: number; own?: boolean }) {
  const reduced = useReducedInteractionMotion();
  const previous = useRef(score);
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const changed = score > previous.current;
    previous.current = score;
    if (!changed || reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 380,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [score, reduced, progress]);
  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View
        style={{
          opacity: progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.7, 0] }),
          transform: [
            { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.4] }) },
            { rotate: '-8deg' },
          ],
        }}
      >
        {[-7, 0, 7].map((offset) => (
          <View
            key={offset}
            style={[
              styles.streak,
              {
                marginVertical: 3,
                marginHorizontal: Math.abs(offset) * 3,
                backgroundColor: own ? '#D2FFA8' : '#D3B3FF',
              },
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { position: 'absolute', top: '45%', left: '10%', right: '10%' },
  streak: { height: 2, borderRadius: 2 },
});
