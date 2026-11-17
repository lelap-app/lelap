import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';

import { AddonReviewHost } from '../src/addonReview';
import { currentLanguage, subscribeLanguage } from '../src/i18n';
import { DialogHost } from '../src/dialog';
import { SandboxHost } from '../src/sandbox/SandboxHost';
import { queryClient, syncAddonsNow } from '../src/addons';
import { listProfiles } from '@lelap/core';

import { db, useDbReady } from '../src/db';
import { ProfilePicker } from '../src/components/ProfilePicker';
import { loadActiveProfile } from '../src/profile';
import { DeviceRunner } from '../src/devices';
import { DownloadSync } from '../src/downloads';
import { PlayerProvider, useLibrary } from '../src/player';
import { HandoffBanner } from '../src/components/HandoffBanner';
import { PodcastSync } from '../src/podcasts';
import { SyncRunner } from '../src/sync';
import { offerUpdateOnStart } from '../src/updates';
import { OtaRunner } from '../src/ota';
import { registerBackgroundRefresh } from '../src/background';

/** Installs the default add-ons on first start and refreshes manifests on every start. */
function AddonSync() {
  const { refresh } = useLibrary();
  useEffect(() => {
    void syncAddonsNow().finally(refresh);
    void offerUpdateOnStart();
    void registerBackgroundRefresh().catch(() => {});
  }, [refresh]);
  return null;
}

/** “Who's listening?” over the app at launch, only when there is more than one profile. */
function ProfileGate() {
  const [picked, setPicked] = useState(() => listProfiles(db).length <= 1);
  if (picked) return null;
  return (
    <View className="absolute inset-0">
      <ProfilePicker atLaunch onPicked={() => setPicked(true)} />
    </View>
  );
}

export default function RootLayout() {
  const { ready, error } = useDbReady();
  // Text is read at render time, so a new language (a switch, or another profile) redraws it all.
  const language = useSyncExternalStore(subscribeLanguage, currentLanguage, currentLanguage);
  // Before anything reads or saves: the profile this device used last.
  const profileLoaded = useMemo(() => {
    if (ready) loadActiveProfile();
    return ready;
  }, [ready]);

  if (error) {
    return (
      <View className="flex-1 justify-center bg-night p-6">
        <Text className="text-danger">Lelap could not open its library: {error.message}</Text>
      </View>
    );
  }
  if (!ready || !profileLoaded) return <View className="flex-1 bg-night" />;

  return (
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <AddonSync />
        <DownloadSync />
        <PodcastSync />
        <SyncRunner />
        <OtaRunner />
        <DeviceRunner />
        <Stack
          key={language}
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0d0e11' } }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="player"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="who" options={{ presentation: 'modal' }} />
          <Stack.Screen name="car" options={{ animation: 'fade' }} />
        </Stack>
        <HandoffBanner />
        <DialogHost />
        <AddonReviewHost />
        <SandboxHost />
        <ProfileGate />
        <StatusBar style="light" />
      </PlayerProvider>
    </QueryClientProvider>
  );
}
