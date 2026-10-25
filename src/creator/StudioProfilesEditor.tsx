import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SoundPressable } from '@/components/SoundPressable';
import { useReducedInteractionMotion } from '@/components/InteractionMotion';
import type { StudioIdentity, StudioProfiles } from './studioProfiles';
import { StudioAvatar } from './StudioAvatar';
import { studioProfilesRepository } from './studioProfilesRepository';

export function StudioProfilesEditor({
  profiles,
  onSaved,
  onClose,
}: {
  profiles: StudioProfiles;
  onSaved(profiles: StudioProfiles): void;
  onClose(): void;
}) {
  const reduced = useReducedInteractionMotion();
  const [edited, setEdited] = useState(profiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const saving = useRef(false);
  const drafts = useRef(new Set<string>());
  const discardDrafts = (keep = new Set<string | null>()) => {
    for (const uri of drafts.current) {
      if (!keep.has(uri)) void studioProfilesRepository.discardPhoto(uri).catch(() => undefined);
    }
    drafts.current.clear();
  };
  useEffect(() => {
    mounted.current = true;
    const selected = drafts.current;
    return () => {
      mounted.current = false;
      if (!saving.current) {
        for (const uri of selected)
          void studioProfilesRepository.discardPhoto(uri).catch(() => undefined);
        selected.clear();
      }
    };
  }, []);
  const pick = async (role: 'player' | 'opponent') => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    try {
      const uri = await studioProfilesRepository.pickPhoto();
      if (uri && mounted.current) {
        drafts.current.add(uri);
        setEdited((current) => ({ ...current, [role]: { ...current[role], photoUri: uri } }));
      } else if (uri) await studioProfilesRepository.discardPhoto(uri);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'That photo could not open. Try again.');
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const save = async () => {
    if (operation.current) return;
    operation.current = true;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await studioProfilesRepository.save(edited);
      discardDrafts(new Set([saved.player.photoUri, saved.opponent.photoUri]));
      if (mounted.current) onSaved(saved);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : 'The profiles could not save. Try again.',
        );
    } finally {
      saving.current = false;
      operation.current = false;
      if (!mounted.current) discardDrafts();
      else setBusy(false);
    }
  };
  const close = () => {
    if (!operation.current) onClose();
  };
  return (
    <Modal transparent visible animationType={reduced ? 'none' : 'fade'} onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView style={styles.scrim}>
          <View style={styles.panel}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text style={styles.heading}>YOUR MATCH. YOUR PLAYERS.</Text>
              <Text style={styles.note}>
                Names and photos appear in the battle and final score.
              </Text>
              <View style={styles.players}>
                {(['player', 'opponent'] as const).map((role) => (
                  <IdentityEditor
                    key={role}
                    role={role}
                    identity={edited[role]}
                    disabled={busy}
                    onChange={(identity) =>
                      setEdited((current) => ({ ...current, [role]: identity }))
                    }
                    onPhoto={() => void pick(role)}
                  />
                ))}
              </View>
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <PrimaryButton
                label="SAVE PLAYERS"
                loading={busy}
                disabled={busy || !edited.player.name.trim() || !edited.opponent.name.trim()}
                onPress={() => void save()}
              />
              <PrimaryButton label="CANCEL" variant="quiet" disabled={busy} onPress={close} />
              <Text style={styles.privacy}>
                Ghost Battle only · selected photos stay on this device.
              </Text>
            </ScrollView>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function IdentityEditor({
  role,
  identity,
  disabled,
  onChange,
  onPhoto,
}: {
  role: 'player' | 'opponent';
  identity: StudioIdentity;
  disabled: boolean;
  onChange(identity: StudioIdentity): void;
  onPhoto(): void;
}) {
  const yours = role === 'player';
  return (
    <View style={styles.card}>
      <Text style={[styles.label, yours && styles.you]}>{yours ? 'YOU' : 'OPPONENT'}</Text>
      <SoundPressable
        accessibilityRole="button"
        accessibilityLabel={
          yours ? 'Change your profile picture' : 'Change opponent profile picture'
        }
        disabled={disabled}
        onPress={onPhoto}
        style={styles.photoButton}
      >
        <StudioAvatar name={identity.name} photoUri={identity.photoUri} size={64} />
        <Text style={styles.photoText}>CHANGE PHOTO</Text>
      </SoundPressable>
      <TextInput
        accessibilityLabel={yours ? 'Your Studio name' : 'Opponent Studio name'}
        value={identity.name}
        maxLength={32}
        editable={!disabled}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="done"
        onChangeText={(name) => onChange({ ...identity, name })}
        placeholder={yours ? 'Your name' : 'Opponent name'}
        placeholderTextColor="#8190A5"
        style={styles.input}
      />
      {identity.photoUri ? (
        <SoundPressable
          accessibilityRole="button"
          accessibilityLabel={
            yours ? 'Remove your profile picture' : 'Remove opponent profile picture'
          }
          disabled={disabled}
          onPress={() => onChange({ ...identity, photoUri: null })}
          style={styles.remove}
        >
          <Text style={styles.removeText}>Remove photo</Text>
        </SoundPressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: '#03060BE8' },
  panel: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '100%',
    alignSelf: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#574970',
    backgroundColor: '#111622',
    overflow: 'hidden',
  },
  content: { padding: 18, gap: 12 },
  heading: { color: '#D1FFA6', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  note: { color: '#B6BED0', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  players: { flexDirection: 'row', gap: 10 },
  card: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    padding: 10,
    borderRadius: 15,
    backgroundColor: '#1C2332',
    gap: 8,
  },
  label: { color: '#C5AAFF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  you: { color: '#C9FFA3' },
  photoButton: { alignItems: 'center', gap: 8, paddingVertical: 5 },
  photoText: { color: '#D8D0F2', fontSize: 9, fontWeight: '800' },
  input: {
    width: '100%',
    minHeight: 44,
    borderBottomWidth: 1,
    borderColor: '#525E78',
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
  },
  remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  removeText: { color: '#A5B2CA', fontSize: 10 },
  error: { color: '#FF9BB2', fontSize: 12, lineHeight: 17 },
  privacy: { color: '#8796AE', fontSize: 10, textAlign: 'center' },
});
