let configured: Promise<void> | null = null;

export function configurePlaybackSession() {
  configured ??= import('expo-audio')
    .then(({ setAudioModeAsync }) =>
      setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
        shouldPlayInBackground: false,
        playsInSilentMode: false,
        interruptionMode: 'mixWithOthers',
        shouldRouteThroughEarpiece: false,
      }),
    )
    .catch((error: unknown) => {
      configured = null;
      throw error;
    });
  return configured;
}
