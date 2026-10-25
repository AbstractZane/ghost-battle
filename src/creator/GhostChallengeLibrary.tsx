import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SoundPressable } from '@/components/SoundPressable';
import { formatDuration } from '@/utils/format';
import type { GhostChallenge } from './ghostChallenges';
import { GhostInsignia } from './GhostInsignia';

export function GhostChallengeLibrary({
  entries,
  busy,
  onNew,
  onEdit,
  onRace,
  onRemove,
}: {
  entries: GhostChallenge[];
  busy: boolean;
  onNew(): void;
  onEdit(entry: GhostChallenge): void;
  onRace(entry: GhostChallenge): void;
  onRemove(entry: GhostChallenge): void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const wide = useWindowDimensions().width >= 800;
  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>YOUR CHALLENGE LIBRARY</Text>
        <Text style={styles.title}>A rival. Any time.</Text>
        <Text style={styles.copy}>
          Beat a recorded performance with real push-ups. Your camera counts. The video sets the
          pace.
        </Text>
      </View>
      {entries.length ? (
        <FlatList
          key={wide ? 'wide' : 'phone'}
          numColumns={wide ? 2 : 1}
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          columnWrapperStyle={wide ? styles.columns : undefined}
          renderItem={({ item, index }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.number}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.saved}>SAVED ON THIS DEVICE</Text>
              </View>
              <Text numberOfLines={2} style={styles.cardTitle}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.ghostName}>
                GHOST · {item.clip.name}
              </Text>
              <View style={styles.stats}>
                <View>
                  <Text style={styles.value}>
                    {item.clip.repTimesMs.length}
                    <Text style={styles.unit}> REPS</Text>
                  </Text>
                  <Text style={styles.statLabel}>THE SCORE TO BEAT</Text>
                </View>
                <View>
                  <Text style={styles.value}>
                    {formatDuration(Math.ceil(item.clip.durationMs / 1000))}
                  </Text>
                  <Text style={styles.statLabel}>FULL VIDEO ROUND</Text>
                </View>
              </View>
              <View style={styles.buttons}>
                <PrimaryButton
                  compact
                  label="RACE GHOST"
                  disabled={busy}
                  onPress={() => onRace(item)}
                  style={styles.race}
                />
                <SoundPressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.title}`}
                  disabled={busy}
                  onPress={() => onEdit(item)}
                  style={styles.edit}
                >
                  <Text style={styles.editText}>EDIT</Text>
                </SoundPressable>
                <SoundPressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.title}`}
                  disabled={busy}
                  onPress={() => setRemoving(item.id)}
                  style={styles.edit}
                >
                  <Text style={styles.editText}>×</Text>
                </SoundPressable>
              </View>
              {removing === item.id ? (
                <View style={styles.confirm}>
                  <Text style={styles.copy}>
                    Remove this saved challenge? Your original video is kept.
                  </Text>
                  <View style={styles.buttons}>
                    <PrimaryButton
                      compact
                      label="REMOVE CHALLENGE"
                      variant="secondary"
                      disabled={busy}
                      onPress={() => {
                        setRemoving(null);
                        onRemove(item);
                      }}
                      style={styles.race}
                    />
                    <PrimaryButton
                      compact
                      label="CANCEL"
                      variant="quiet"
                      onPress={() => setRemoving(null)}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <View style={styles.empty}>
          <GhostInsignia />
          <Text style={styles.emptyTitle}>Your next rival is in your camera roll.</Text>
          <Text style={styles.copy}>
            Choose a workout video, mark each completed push-up, then race the ghost whenever you
            want.
          </Text>
          <View style={styles.steps}>
            {['1  IMPORT VIDEO', '2  MARK REPS', '3  RACE GHOST'].map((step) => (
              <Text key={step} style={styles.step}>
                {step}
              </Text>
            ))}
          </View>
        </View>
      )}
      <PrimaryButton
        label={entries.length ? '＋ NEW CHALLENGE' : 'CREATE YOUR FIRST GHOST'}
        disabled={busy}
        onPress={onNew}
      />
      <Text style={styles.note}>
        Local challenges · recorded opponent · no uploads or ranked rating
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  confirm: { gap: 8, borderTopWidth: 1, borderColor: '#37435A', paddingTop: 10 },
  root: { flex: 1, gap: 12, minHeight: 0 },
  intro: { gap: 8, paddingTop: 8 },
  eyebrow: { color: '#B49AD9', fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  title: { fontSize: 33, lineHeight: 38, fontWeight: '900', color: '#F3F5FF' },
  copy: { fontSize: 13, lineHeight: 19, color: '#AAB8CE' },
  list: { gap: 12, paddingBottom: 6 },
  columns: { gap: 12 },
  card: {
    flex: 1,
    backgroundColor: '#141D2C',
    borderRadius: 20,
    padding: 17,
    gap: 11,
    borderWidth: 1,
    borderColor: '#3A3554',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  number: { color: '#AD8EEA', fontSize: 13, fontWeight: '900' },
  saved: { fontSize: 7, letterSpacing: 1, color: '#7F92A9' },
  cardTitle: { color: '#F0F4FF', fontSize: 22, fontWeight: '900' },
  ghostName: { color: '#B8A3E1', fontSize: 10, fontWeight: '700' },
  stats: { flexDirection: 'row', gap: 30, marginVertical: 5 },
  value: { color: '#D6FBAF', fontSize: 29, fontWeight: '900', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 10 },
  statLabel: { color: '#8191A9', fontSize: 8, marginTop: 3, letterSpacing: 0.7 },
  buttons: { flexDirection: 'row', gap: 8 },
  race: { flex: 1 },
  edit: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  editText: { color: '#BAA8D7', fontSize: 10, fontWeight: '800' },
  empty: { flex: 1, justifyContent: 'center', gap: 14, paddingHorizontal: 8 },
  ghost: { color: '#B79BFF', fontSize: 66 },
  emptyTitle: { fontSize: 26, lineHeight: 31, fontWeight: '900', color: '#DDFAB7' },
  steps: { gap: 8 },
  step: { color: '#A791CB', fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  note: { color: '#76869E', fontSize: 9, textAlign: 'center', lineHeight: 14, paddingBottom: 4 },
});
