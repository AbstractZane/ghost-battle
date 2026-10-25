import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { InteractionMotionProvider } from '@/components/InteractionMotion';
import { SoundEffectsProvider } from '@/audio/SoundEffectsProvider';
import { GhostResultsOverlay } from '@/creator/GhostResultsOverlay';
import { defaultStudioProfiles } from '@/creator/studioProfiles';
import type { VideoRoundSnapshot } from '@/creator/videoRival';

/** Separate visual-test entry only. Never imported by the app, detector, or battle route. */
export default function ResultsLayout() {
  const [example, setExample] = useState(0);
  const outcomes = ['victory', 'defeat', 'draw'] as const;
  const outcome = outcomes[example % outcomes.length]!;
  const snapshot: VideoRoundSnapshot = {
    phase: 'complete',
    elapsedMs: 60_000,
    remainingMs: 0,
    playerScore: outcome === 'victory' ? 28 : outcome === 'defeat' ? 20 : 24,
    opponentScore: 24,
    outcome,
  };
  return (
    <SafeAreaProvider>
      <InteractionMotionProvider reducedMotion>
        <SoundEffectsProvider>
          <View style={styles.background}>
            <Text style={styles.label}>UI LAYOUT FIXTURE · NO CAMERA OR LIVE SCORING</Text>
            <GhostResultsOverlay
              key={example}
              identity={`layout-fixture:${example}`}
              snapshot={snapshot}
              profiles={defaultStudioProfiles('UI fixture · you', 'UI fixture · ghost')}
              onRematch={() => setExample((value) => value + 1)}
              onSetup={() => setExample((value) => value + 1)}
            />
          </View>
        </SoundEffectsProvider>
      </InteractionMotionProvider>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: '#111A2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: { color: '#9BABBF', fontSize: 12 },
});
