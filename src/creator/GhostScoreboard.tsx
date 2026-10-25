import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useReducedInteractionMotion } from '@/components/InteractionMotion';
import { SoundPressable } from '@/components/SoundPressable';
import { formatDuration } from '@/utils/format';
import { ghostBattlePresentation } from './ghostChallenges';
import type { VideoRoundSnapshot } from './videoRival';

export function GhostScoreboard({
  snapshot,
  durationMs,
  onMenu,
}: {
  snapshot: VideoRoundSnapshot;
  durationMs: number;
  onMenu(): void;
}) {
  const view = ghostBattlePresentation(snapshot, durationMs);
  return (
    <View style={styles.board}>
      <View style={styles.top}>
        <View style={styles.heading}>
          <Text style={styles.brand}>GHOST BATTLE</Text>
          <Text style={styles.subtitle}>YOU VS. A RECORDED PERFORMANCE</Text>
        </View>
        <View style={styles.timer}>
          <Text
            accessibilityLabel={`${Math.ceil(snapshot.remainingMs / 1000)} seconds remaining`}
            style={[styles.time, snapshot.remainingMs <= 10_000 && styles.urgent]}
          >
            {formatDuration(Math.ceil(snapshot.remainingMs / 1000))}
          </Text>
          <Text style={styles.remaining}>REMAINING</Text>
        </View>
        <SoundPressable
          accessibilityRole="button"
          accessibilityLabel="Battle menu"
          onPress={onMenu}
          style={styles.menu}
        >
          <Text style={styles.menuText}>☰</Text>
        </SoundPressable>
      </View>
      <View style={styles.leadRow}>
        <Text style={styles.you}>YOU · {snapshot.playerScore}</Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.lead, view.difference < 0 && styles.ghostLead]}
        >
          {view.lead}
        </Text>
        <Text style={styles.ghost}>GHOST · {snapshot.opponentScore}</Text>
      </View>
      <View style={styles.tug}>
        <View style={{ flex: Math.max(0.01, view.share), backgroundColor: '#C5F68F' }} />
        <View style={{ flex: Math.max(0.01, 1 - view.share), backgroundColor: '#AA86F4' }} />
      </View>
      <View
        style={styles.progress}
        accessibilityRole="progressbar"
        accessibilityLabel="Match progress"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(view.progress * 100) }}
      >
        <View style={[styles.progressFill, { width: `${view.progress * 100}%` }]} />
      </View>
    </View>
  );
}

export function GhostRepCounter({ score, own }: { score: number; own: boolean }) {
  const reduced = useReducedInteractionMotion();
  const previous = useRef(score);
  const [change, setChange] = useState(0);
  const scale = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const delta = score - previous.current;
    previous.current = score;
    if (delta <= 0 || reduced) {
      setChange(0);
      scale.setValue(1);
      pop.setValue(1);
      return;
    }
    setChange(delta);
    scale.setValue(1);
    pop.setValue(0);
    const motion = Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.16, duration: 110, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 190, useNativeDriver: true }),
      ]),
      Animated.timing(pop, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]);
    motion.start();
    return () => motion.stop();
  }, [pop, reduced, scale, score]);
  return (
    <View style={styles.counterWrap}>
      <Animated.Text
        accessibilityLabel={`${score} pushups`}
        style={[styles.counter, { color: own ? '#D6FFAF' : '#D1BAFF', transform: [{ scale }] }]}
      >
        {score}
      </Animated.Text>
      {change > 0 ? (
        <Animated.Text
          pointerEvents="none"
          style={[
            styles.plus,
            {
              color: own ? '#D6FFAF' : '#D1BAFF',
              opacity: pop.interpolate({
                inputRange: [0, 0.15, 0.8, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [0, -28] }) },
              ],
            },
          ]}
        >
          +{change}
        </Animated.Text>
      ) : null}
    </View>
  );
}

export function GhostBattleFeedback({ snapshot }: { snapshot: VideoRoundSnapshot }) {
  const [message, setMessage] = useState<string | null>(null);
  const previous = useRef({ player: 0, leader: 0 });
  useEffect(() => {
    if (snapshot.phase !== 'active') {
      setMessage(null);
      return;
    }
    const leader = Math.sign(snapshot.playerScore - snapshot.opponentScore);
    const milestone =
      Math.floor(snapshot.playerScore / 10) > Math.floor(previous.current.player / 10);
    const text = milestone
      ? `${Math.floor(snapshot.playerScore / 10) * 10} PUSH-UPS. KEEP BUILDING.`
      : leader !== previous.current.leader
        ? leader > 0
          ? 'YOU TOOK THE LEAD'
          : leader < 0
            ? 'CHASE THE GHOST'
            : 'ALL SQUARE'
        : null;
    previous.current = { player: snapshot.playerScore, leader };
    if (!text) return;
    setMessage(text);
  }, [snapshot.opponentScore, snapshot.phase, snapshot.playerScore]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [message]);
  return message ? (
    <View pointerEvents="none" style={styles.feedback}>
      <Text accessibilityLiveRegion="polite" style={styles.feedbackText}>
        {message}
      </Text>
    </View>
  ) : null;
}
const styles = StyleSheet.create({
  board: { backgroundColor: '#0A111E', paddingHorizontal: 14, paddingBottom: 10, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, gap: 4 },
  brand: { color: '#ECE6FF', fontWeight: '900', fontSize: 13, letterSpacing: 1.5 },
  subtitle: { color: '#6F839E', fontSize: 7, letterSpacing: 0.7 },
  timer: { alignItems: 'center' },
  time: { fontSize: 27, fontWeight: '900', color: '#F1F5FF', fontVariant: ['tabular-nums'] },
  remaining: { color: '#71849C', fontSize: 7, letterSpacing: 1 },
  urgent: { color: '#F3CB8C' },
  menu: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: '#172135',
  },
  menuText: { fontSize: 22, color: '#D7DEF0' },
  leadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  you: { fontSize: 9, color: '#C5F68F', fontWeight: '900' },
  ghost: { fontSize: 9, color: '#C5A8FF', fontWeight: '900' },
  lead: { color: '#D5E8C4', fontSize: 8, fontWeight: '800', letterSpacing: 0.6 },
  ghostLead: { color: '#BAA2E7' },
  tug: { height: 5, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', gap: 2 },
  progress: { height: 2, backgroundColor: '#253248', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#62758F' },
  counterWrap: { marginLeft: 'auto', minWidth: 54, alignItems: 'center' },
  counter: {
    fontSize: 44,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textShadowColor: '#000',
    textShadowRadius: 7,
  },
  plus: { position: 'absolute', top: -9, right: -5, fontSize: 18, fontWeight: '900' },
  feedback: { position: 'absolute', top: 6, left: 20, right: 20, alignItems: 'center' },
  feedbackText: {
    backgroundColor: '#131C2CEB',
    borderWidth: 1,
    borderColor: '#66508C',
    color: '#DDD0F7',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
});
