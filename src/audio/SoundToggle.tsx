import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SoundPressable } from '@/components/SoundPressable';
import { useAppStore } from '@/store/appStore';
import { useSoundEffects } from './SoundEffectsContext';

export function SoundToggle() {
  const enabled = useAppStore((s) => s.settings.soundEffectsEnabled);
  const update = useAppStore((s) => s.updateSettings);
  const sound = useSoundEffects();
  return (
    <SoundPressable
      accessibilityRole="switch"
      accessibilityLabel="Sound effects"
      accessibilityState={{ checked: enabled }}
      aria-checked={enabled}
      soundCue={false}
      onPress={() => {
        if (enabled) sound.stop();
        void update({ soundEffectsEnabled: !enabled }).catch(() => sound.play('error'));
      }}
      style={styles.button}
    >
      <Text style={styles.text}>{enabled ? 'SOUND ON' : 'SOUND OFF'}</Text>
    </SoundPressable>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(11,8,23,.76)',
    borderWidth: 1,
    borderColor: 'rgba(210,193,240,.22)',
  },
  text: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#E7DEF7' },
});
