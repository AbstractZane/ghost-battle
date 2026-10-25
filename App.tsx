import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  createNavigationContainerRef,
  DarkTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { InteractionMotionProvider } from '@/components/InteractionMotion';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SoundEffectsProvider } from '@/audio/SoundEffectsProvider';
import { NavigationSoundCleanup } from '@/audio/NavigationSoundCleanup';
import { CreatorStudioScreen } from '@/creator/CreatorStudioScreen';
import { VideoBattleScreen } from '@/creator/VideoBattleScreen';
import { colors } from '@/constants/theme';
import { useAppStore } from '@/store/appStore';
import type { RootStackParamList } from '@/types/navigation';

const Stack =
  createNativeStackNavigator<Pick<RootStackParamList, 'CreatorStudio' | 'VideoBattle'>>();
const navigation = createNavigationContainerRef<RootStackParamList>();
const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};

/** Dedicated private entry keeps unrelated map/shop artwork out of filming APKs. */
export default function CreatorApp() {
  const status = useAppStore((state) => state.status);
  const hydrate = useAppStore((state) => state.hydrate);
  const reduced = useAppStore((state) => state.settings.reducedMotion);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return (
    <SafeAreaProvider>
      <InteractionMotionProvider reducedMotion={reduced}>
        <SoundEffectsProvider>
          <StatusBar style="light" />
          {status === 'ready' ? (
            <NavigationContainer ref={navigation} theme={theme}>
              <NavigationSoundCleanup />
              <AppErrorBoundary
                onReturnHome={() => {
                  if (navigation.isReady())
                    navigation.resetRoot({ index: 0, routes: [{ name: 'CreatorStudio' }] });
                }}
              >
                <Stack.Navigator
                  initialRouteName="CreatorStudio"
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.background },
                    animation: reduced ? 'none' : 'fade',
                  }}
                >
                  <Stack.Screen
                    name="CreatorStudio"
                    component={CreatorStudioScreen}
                    options={{ title: 'Ghost Battle' }}
                  />
                  <Stack.Screen
                    name="VideoBattle"
                    component={VideoBattleScreen}
                    options={{ gestureEnabled: false, title: 'Race the Ghost' }}
                  />
                </Stack.Navigator>
              </AppErrorBoundary>
            </NavigationContainer>
          ) : (
            <View style={styles.loading}>
              {status === 'error' ? (
                <>
                  <Text style={styles.message}>Ghost Battle could not open local storage.</Text>
                  <PrimaryButton label="TRY AGAIN" onPress={() => void hydrate()} />
                </>
              ) : (
                <>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.message}>OPENING GHOST BATTLE</Text>
                </>
              )}
            </View>
          )}
        </SoundEffectsProvider>
      </InteractionMotionProvider>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: colors.background,
  },
  message: { color: colors.text, fontWeight: '800', textAlign: 'center' },
});
