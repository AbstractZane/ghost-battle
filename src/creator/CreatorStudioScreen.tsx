import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SoundPressable } from '@/components/SoundPressable';
import { SoundToggle } from '@/audio/SoundToggle';
import { useAppStore } from '@/store/appStore';
import type { RootStackParamList } from '@/types/navigation';
import { clipRepository } from './clipRepository';
import { type VideoRivalClip } from './videoRival';
import { defaultStudioProfiles, type StudioProfiles } from './studioProfiles';
import { studioProfilesRepository } from './studioProfilesRepository';
import { StudioAvatar } from './StudioAvatar';
import { StudioProfilesEditor } from './StudioProfilesEditor';
import { GhostClipEditor } from './GhostClipEditor';
import { GhostChallengeLibrary } from './GhostChallengeLibrary';
import { ghostChallengeRepository } from './ghostChallengeRepository';
import type { GhostChallenge } from './ghostChallenges';

export function CreatorStudioScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const fallbackName = useAppStore((state) => state.profile.displayName);
  const [profiles, setProfiles] = useState<StudioProfiles>(() =>
    defaultStudioProfiles(fallbackName, 'Ghost'),
  );
  const [entries, setEntries] = useState<GhostChallenge[]>([]);
  const [page, setPage] = useState<'library' | 'editor'>('library');
  const [clip, setClip] = useState<VideoRivalClip | null>(null);
  const [title, setTitle] = useState('');
  const [editingPlayers, setEditingPlayers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const visit = useRef<object | null>(null);
  const operation = useRef(false);
  const saving = useRef(false);
  const draft = useRef<string | null>(null);
  const { width, height, fontScale } = useWindowDimensions();
  const compact = height < 780;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!saving.current && draft.current)
        void clipRepository.discard(draft.current).catch(() => undefined);
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      const scope = {};
      visit.current = scope;
      setLoading(true);
      setError(null);
      void Promise.all([ghostChallengeRepository.list(), studioProfilesRepository.load()])
        .then(([items, identities]) => {
          if (visit.current !== scope) return;
          setEntries(items);
          setProfiles(identities ?? defaultStudioProfiles(fallbackName, 'Ghost'));
          setPage('library');
        })
        .catch((cause: unknown) => {
          if (visit.current === scope)
            setError(cause instanceof Error ? cause.message : 'The local library could not open.');
        })
        .finally(() => {
          if (visit.current === scope) {
            setLoading(false);
            setBusy(operation.current);
          }
        });
      return () => {
        if (visit.current === scope) visit.current = null;
      };
    }, [fallbackName, reload]),
  );
  const run = async (action: () => Promise<void>) => {
    if (operation.current || !visit.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'That action could not finish. Please try again.',
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const choose = () =>
    run(async () => {
      const scope = visit.current;
      const picked = await clipRepository.pick();
      if (!picked) return;
      if (!mounted.current || visit.current !== scope) {
        await clipRepository.discard(picked.uri);
        return;
      }
      const previous = draft.current;
      draft.current = picked.uri;
      setClip(picked);
      setTitle(`${profiles.opponent.name}'s challenge`);
      setPage('editor');
      if (previous && previous !== picked.uri)
        await clipRepository.discard(previous).catch(() => undefined);
    });
  const edit = (entry: GhostChallenge) =>
    run(async () => {
      const resolved = await ghostChallengeRepository.open(entry);
      if (!mounted.current) return;
      if (draft.current) await clipRepository.discard(draft.current).catch(() => undefined);
      draft.current = null;
      setClip(resolved);
      setTitle(entry.title);
      setProfiles((current) => ({
        ...current,
        opponent: { ...current.opponent, name: resolved.name },
      }));
      setPage('editor');
    });
  const save = (race: boolean) =>
    run(async () => {
      if (!clip) return;
      saving.current = true;
      try {
        const entry = await ghostChallengeRepository.save(
          { ...clip, name: profiles.opponent.name },
          title.trim(),
        );
        // The library now owns this copy even if navigation or active-selection persistence fails.
        if (draft.current === entry.clip.uri) draft.current = null;
        const selected = await clipRepository.save(entry.clip);
        if (!mounted.current) return;
        setEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
        setClip(selected);
        if (race && visit.current) navigation.navigate('VideoBattle', { clipId: selected.id });
        else setPage('library');
      } finally {
        saving.current = false;
        if (!mounted.current && draft.current) {
          void clipRepository.discard(draft.current).catch(() => undefined);
          draft.current = null;
        }
      }
    });
  const race = (entry: GhostChallenge) =>
    run(async () => {
      const selected = await clipRepository.save(await ghostChallengeRepository.open(entry));
      if (mounted.current && visit.current)
        navigation.navigate('VideoBattle', { clipId: selected.id });
    });
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.root, compact && styles.compact, width > 800 && styles.wide]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.brand}>
                GHOST<Text style={styles.brandAccent}> BATTLE</Text>
              </Text>
              <Text style={styles.subtitle}>BUILT ON PUSHPVP · REAL PUSH-UPS. RECORDED RIVAL.</Text>
            </View>
            {page === 'editor' ? (
              <SoundPressable
                accessibilityRole="button"
                accessibilityLabel="Challenge library"
                onPress={() => {
                  if (!busy) {
                    setPage('library');
                    setError(null);
                  }
                }}
                style={styles.libraryButton}
              >
                <Text style={styles.libraryText}>LIBRARY</Text>
              </SoundPressable>
            ) : (
              <SoundToggle />
            )}
          </View>
          <View style={styles.players}>
            {(['player', 'opponent'] as const).map((role) => (
              <SoundPressable
                key={role}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${role === 'player' ? 'your' : 'opponent'} name and photo`}
                disabled={busy || loading}
                onPress={() => setEditingPlayers(true)}
                style={styles.playerCard}
              >
                <StudioAvatar
                  name={profiles[role].name}
                  photoUri={profiles[role].photoUri}
                  size={compact ? 30 : 36}
                />
                <View style={styles.identity}>
                  <Text style={[styles.role, role === 'player' && styles.you]}>
                    {role === 'player' ? 'YOU' : 'GHOST'} · EDIT
                  </Text>
                  <Text numberOfLines={1} style={styles.name}>
                    {profiles[role].name}
                  </Text>
                </View>
              </SoundPressable>
            ))}
          </View>
          {error ? (
            <View style={styles.errorBox}>
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
              <PrimaryButton
                compact
                label="RETRY LIBRARY"
                onPress={() => setReload((value) => value + 1)}
              />
            </View>
          ) : null}
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#CFFFAC" />
            </View>
          ) : page === 'library' ? (
            <GhostChallengeLibrary
              entries={entries}
              busy={busy}
              onNew={() => void choose()}
              onEdit={(item) => void edit(item)}
              onRace={(item) => void race(item)}
              onRemove={(item) =>
                void run(async () => {
                  await ghostChallengeRepository.remove(item.id);
                  if (mounted.current)
                    setEntries((current) => current.filter((entry) => entry.id !== item.id));
                })
              }
            />
          ) : clip ? (
            <>
              <TextInput
                accessibilityLabel="Challenge name"
                value={title}
                onChangeText={setTitle}
                editable={!busy}
                maxLength={60}
                placeholder="Name your challenge"
                placeholderTextColor="#72839D"
                style={styles.titleInput}
                returnKeyType="done"
              />
              <GhostClipEditor
                key={clip.id}
                clip={clip}
                disabled={busy || editingPlayers}
                onChange={setClip}
                onError={setError}
              />
              <View style={styles.actions}>
                <PrimaryButton
                  label="SAVE & RACE GHOST"
                  disabled={busy || !title.trim() || !clip.repTimesMs.length || !clip.durationMs}
                  loading={busy}
                  onPress={() => void save(true)}
                />
                <View style={styles.secondaryActions}>
                  <PrimaryButton
                    compact
                    label="SAVE TO LIBRARY"
                    variant="secondary"
                    disabled={busy || !title.trim() || !clip.repTimesMs.length}
                    onPress={() => void save(false)}
                    style={styles.action}
                  />
                  <PrimaryButton
                    compact
                    label="CHANGE VIDEO"
                    variant="quiet"
                    disabled={busy}
                    onPress={() => void choose()}
                    style={styles.action}
                  />
                </View>
              </View>
            </>
          ) : null}
          {fontScale <= 1.2 && page === 'editor' ? (
            <Text style={styles.privacy}>
              Video and timestamps stay on this device. Use footage you have permission to use.
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
      {editingPlayers ? (
        <StudioProfilesEditor
          profiles={profiles}
          onClose={() => setEditingPlayers(false)}
          onSaved={(saved) => {
            setProfiles(saved);
            setEditingPlayers(false);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080D16' },
  fill: { flex: 1 },
  root: {
    flex: 1,
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 8,
    width: '100%',
    alignSelf: 'center',
  },
  compact: { gap: 8, paddingHorizontal: 14 },
  wide: { maxWidth: 1100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 62 },
  headerCopy: { flex: 1, gap: 5 },
  brand: { fontSize: 24, fontWeight: '900', color: '#F4F6FF', letterSpacing: 1 },
  brandAccent: { color: '#BDA3FF' },
  subtitle: { fontSize: 7, color: '#768AA5', fontWeight: '800', letterSpacing: 1 },
  libraryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 9 },
  libraryText: { color: '#B9A3EA', fontSize: 10, fontWeight: '800' },
  players: { flexDirection: 'row', gap: 8 },
  playerCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#151E2D',
    borderWidth: 1,
    borderColor: '#303C53',
    borderRadius: 14,
    padding: 9,
  },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  role: { color: '#B49CDB', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  you: { color: '#C9FFA3' },
  name: { color: '#F2F5FF', fontSize: 13, fontWeight: '800' },
  titleInput: {
    backgroundColor: '#111C2C',
    borderWidth: 1,
    borderColor: '#34435C',
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 40,
    color: '#F2F6FF',
    fontSize: 15,
    fontWeight: '700',
  },
  loading: { flex: 1, justifyContent: 'center' },
  errorBox: {
    padding: 10,
    backgroundColor: '#2A1A2A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#75455D',
    gap: 6,
  },
  error: { color: '#FFB6C8', fontSize: 12, lineHeight: 17 },
  actions: { gap: 6 },
  secondaryActions: { flexDirection: 'row', gap: 6 },
  action: { flex: 1, minWidth: 0 },
  privacy: { color: '#798CA7', fontSize: 9, lineHeight: 13, textAlign: 'center' },
});
