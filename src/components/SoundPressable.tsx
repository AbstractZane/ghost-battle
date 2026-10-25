import React, { forwardRef } from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';
import { useSoundEffects } from '@/audio/SoundEffectsContext';
import type { SoundCue } from '@/audio/SoundEffectsEngine';

export const SoundPressable = forwardRef<View, PressableProps & { soundCue?: SoundCue | false }>(
  function SoundPressable({ onPress, disabled, soundCue, ...props }, ref) {
    const sound = useSoundEffects();
    return (
      <Pressable
        {...props}
        ref={ref}
        disabled={disabled}
        onPress={(event) => {
          if (disabled || !onPress) return;
          sound.unlock();
          const cue =
            soundCue ??
            (props.accessibilityRole === 'link' || props.accessibilityRole === 'tab'
              ? 'navigate'
              : 'press');
          if (cue) sound.play(cue);
          onPress(event);
        }}
      />
    );
  },
);
