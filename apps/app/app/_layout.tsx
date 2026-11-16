import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { queryClient, syncAddonsNow } from '../src/addons';
import { useDbReady } from '../src/db';
import { DownloadSync } from '../src/downloads';
import { PlayerProvider, useLibrary } from '../src/player';
import { HandoffBanner } from '../src/components/HandoffBanner';
import { PodcastSync } from '../src/podcasts';
import { SyncRunner } from '../src/sync';
import { offerUpdateOnStart } from '../src/updates';

/** Installs the default add-ons on first start and refreshes manifests on every start. */
function AddonSync() {
  const { refresh } = useLibrary();
  useEffect(() => {
    void syncAddonsNow().finally(refresh);
    void offerUpdateOnStart();
  }, [refresh]);
  return null;
}

export default function RootLayout() {
  const { ready, error } = useDbReady();

  if (error) {
    return (
      <View className="flex-1 justify-center bg-night p-6">
        <Text className="text-danger">Lelap could not open its library: {error.message}</Text>
      </View>
    );
  }
  if (!ready) return <View className="flex-1 bg-night" />;

  return (
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <AddonSync />
        <DownloadSync />
        <PodcastSync />
        <SyncRunner />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0d0e11' } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="player"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack>
        <HandoffBanner />
        <StatusBar style="light" />
      </PlayerProvider>
    </QueryClientProvider>
  );
}
