import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useRankAnimation } from '@/components/useRankAnimation';
import { useSoundEffects } from '@/audio/SoundEffectsContext';
import { useAppStore } from '@/store/appStore';
import { AvatarFrame } from '@/shop/CosmeticArtwork';
import { MatchVictoryCelebration } from '@/multiplayer/results/MatchVictoryCelebration';
import { formatDuration } from '@/utils/format';
import { StudioAvatar } from './StudioAvatar';
import type { StudioProfiles } from './studioProfiles';
import type { VideoRoundSnapshot } from './videoRival';
import { ghostBattlePresentation } from './ghostChallenges';

export function GhostResultsOverlay({
  identity,
  snapshot,
  profiles,
  onRematch,
  onSetup,
}: {
  identity: string;
  snapshot: VideoRoundSnapshot;
  profiles: StudioProfiles;
  onRematch(): void;
  onSetup(): void;
}) {
  const { height, fontScale } = useWindowDimensions();
  const view = ghostBattlePresentation(snapshot, snapshot.elapsedMs);
  const sound = useSoundEffects();
  const haptics = useAppStore((state) => state.settings.haptics);
  const announced = useRef(false);
  const { progress } = useRankAnimation(350, identity, snapshot.outcome === 'victory' ? 500 : 0);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    sound.play(
      snapshot.outcome === 'victory' ? 'win' : snapshot.outcome === 'defeat' ? 'loss' : 'draw',
      { eventKey: `${identity}:result`, scope: identity },
    );
    if (haptics)
      void Haptics.notificationAsync(
        snapshot.outcome === 'victory'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
  }, [haptics, identity, snapshot.outcome, sound]);
  const max = Math.max(1, snapshot.playerScore, snapshot.opponentScore);
  const content = (
    <View style={styles.content}>
      <Text style={styles.eyebrow}>GHOST BATTLE · COMPLETE</Text>
      <Text
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        style={[styles.result, snapshot.outcome === 'defeat' && styles.loss]}
      >
        {view.result}
      </Text>
      <Text style={styles.margin}>{view.marginLabel}</Text>
      <View style={styles.players}>
        {(['player', 'opponent'] as const).map((role) => {
          const winner =
            (role === 'player' && snapshot.outcome === 'victory') ||
            (role === 'opponent' && snapshot.outcome === 'defeat');
          const size = height < 740 ? 56 : 68;
          return (
            <View key={role} style={styles.person}>
              <View style={[styles.portrait, winner && styles.winner]}>
                <StudioAvatar
                  name={profiles[role].name}
                  photoUri={profiles[role].photoUri}
                  size={size}
                />
                <View pointerEvents="none" style={styles.frame}>
                  <AvatarFrame
                    id={winner ? 'solar_flare' : 'void_portal'}
                    size={size}
                    phase={progress}
                    moving={false}
                  />
                </View>
                {winner ? (
                  <Text accessibilityLabel="Winner" style={styles.crown}>
                    ♛
                  </Text>
                ) : null}
              </View>
              <Text numberOfLines={1} style={styles.name}>
                {profiles[role].name}
              </Text>
              <Text style={role === 'player' ? styles.you : styles.ghost}>
                {role === 'player' ? 'YOU' : 'RECORDED GHOST'}
              </Text>
              <Text style={styles.score}>
                {role === 'player' ? snapshot.playerScore : snapshot.opponentScore}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={styles.comparison}>
        <View style={styles.compareHeading}>
          <Text style={styles.smallLabel}>THE SAME CLOCK. YOUR OWN EFFORT.</Text>
          <Text style={styles.duration}>
            {formatDuration(Math.ceil(snapshot.elapsedMs / 1000))}
          </Text>
        </View>
        {[
          ['YOU', snapshot.playerScore, '#CAF49B'],
          ['GHOST', snapshot.opponentScore, '#AA87F0'],
        ].map(([label, score, color]) => (
          <View key={label} style={styles.compareRow}>
            <Text style={styles.barLabel}>{label}</Text>
            <View style={styles.track}>
              <Animated.View
                style={{
                  height: '100%',
                  width: `${(Number(score) / max) * 100}%`,
                  backgroundColor: String(color),
                  transformOrigin: 'left center',
                  transform: [{ scaleX: progress }],
                }}
              />
            </View>
            <Text style={styles.barScore}>{score}</Text>
          </View>
        ))}
        <Text style={styles.caption}>
          Your score comes from accepted camera reps. The ghost follows your marked video timeline.
        </Text>
      </View>
      <PrimaryButton label="RACE AGAIN" onPress={onRematch} />
      <PrimaryButton compact label="CHALLENGE LIBRARY" variant="secondary" onPress={onSetup} />
      <Text style={styles.note}>LOCAL CHALLENGE · NO RANKED RATING OR ACCOUNT REWARDS</Text>
    </View>
  );
  return (
    <Modal visible transparent animationType="none" onRequestClose={onSetup} statusBarTranslucent>
      <SafeAreaView style={styles.scrim}>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            {
              opacity: progress,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
              ],
            },
          ]}
        >
          {height < 690 || fontScale > 1.2 ? (
            <ScrollView bounces={false}>{content}</ScrollView>
          ) : (
            content
          )}
        </Animated.View>
        {snapshot.outcome === 'victory' ? (
          <MatchVictoryCelebration identity={`ghost:${identity}`} eligible />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: '#040912C9',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  panel: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '96%',
    backgroundColor: '#101827',
    borderWidth: 1,
    borderColor: '#506148',
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 24,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
  },
  content: { padding: 20, gap: 12 },
  eyebrow: {
    textAlign: 'center',
    color: '#98A8C2',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  result: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 3,
    textAlign: 'center',
    color: '#DBFFAF',
  },
  loss: { color: '#C5B4EE' },
  margin: { textAlign: 'center', color: '#B7C5D9', fontSize: 13 },
  players: { flexDirection: 'row', gap: 20, marginTop: 12, marginBottom: 2 },
  person: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  portrait: {
    padding: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#42395F',
    backgroundColor: '#211E36',
  },
  winner: { borderColor: '#C0DB8B', backgroundColor: '#26301E' },
  frame: { position: 'absolute', left: 5, top: 5 },
  crown: {
    position: 'absolute',
    top: -22,
    alignSelf: 'center',
    color: '#F3D487',
    fontSize: 27,
    textShadowColor: '#D8A74E',
    textShadowRadius: 8,
  },
  name: { color: '#F1F4FC', fontSize: 14, fontWeight: '800', textAlign: 'center', width: '100%' },
  you: { fontSize: 8, color: '#C3F397', letterSpacing: 1, fontWeight: '900' },
  ghost: { fontSize: 8, color: '#B59BE7', letterSpacing: 0.7, fontWeight: '900' },
  score: { color: '#F3F6FF', fontSize: 41, fontWeight: '900', fontVariant: ['tabular-nums'] },
  comparison: {
    backgroundColor: '#151F31',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2B3B53',
    padding: 12,
    gap: 9,
  },
  compareHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 5,
  },
  smallLabel: { color: '#8496B0', fontSize: 7, letterSpacing: 0.5, fontWeight: '800' },
  duration: { color: '#B5C1D6', fontSize: 10, fontWeight: '700' },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 35, fontSize: 8, fontWeight: '900', color: '#A8B7CF' },
  track: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: '#29344A' },
  barScore: { width: 25, textAlign: 'right', fontSize: 12, fontWeight: '800', color: '#E0E9F7' },
  caption: { fontSize: 10, lineHeight: 15, color: '#8598B3' },
  note: { fontSize: 7, lineHeight: 12, color: '#7187A2', letterSpacing: 0.5, textAlign: 'center' },
});
