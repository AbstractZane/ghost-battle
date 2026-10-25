import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NavigationState, PartialState } from '@react-navigation/native';
import { useSoundEffects } from './SoundEffectsContext';

function leafKey(
  state: NavigationState | PartialState<NavigationState> | undefined,
): string | undefined {
  const route = state?.routes[state.index ?? 0];
  return route?.state ? leafKey(route.state) : route?.key;
}
export function NavigationSoundCleanup() {
  const navigation = useNavigation();
  const sound = useSoundEffects();
  useEffect(() => {
    let previous = leafKey(navigation.getState());
    return navigation.addListener('state', () => {
      const next = leafKey(navigation.getState());
      if (next !== previous) {
        sound.stop();
        if (previous) sound.play('navigate', { scope: 'navigation' });
      }
      previous = next;
    });
  }, [navigation, sound]);
  return null;
}
