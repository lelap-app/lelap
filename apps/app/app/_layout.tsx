import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { I18nManager, Text, useWindowDimensions, View } from 'react-native';

import { AddonReviewHost } from '../src/addonReview';
import { currentLanguage, subscribeLanguage } from '../src/i18n';
import { DialogHost } from '../src/dialog';
import { useReducedMotion } from '../src/components/Motion';
import { SandboxHost } from '../src/sandbox/SandboxHost';
import { queryClient, syncAddonsNow } from '../src/addons';
import { listProfiles } from '@lelap/core';

import { db, useDbReady } from '../src/db';
import { startDiagnostics } from '../src/diagnostics';
import { ProfilePicker } from '../src/components/ProfilePicker';
import { loadActiveProfile } from '../src/profile';
import { DeviceRunner } from '../src/devices';
import { DownloadSync } from '../src/downloads';
import { SilenceSync } from '../src/silences';
import { PlayerProvider, useLibrary } from '../src/player';
import { BadgeSourceProvider } from '../src/components/CoverBadges';
import { HandoffBanner } from '../src/components/HandoffBanner';
import { DetailPane } from '../src/components/DetailPane';
import { PlayerBelow, PlayerPane } from '../src/components/PlayerPane';
import { InstalledAppHost } from '../src/installed';
import { ShortcutsHost } from '../src/shortcuts';
import { PodcastSync } from '../src/podcasts';
import { ClipStop } from '../src/clips';
import { SyncRunner } from '../src/sync';
import { syncCatalogCovers } from '../src/catalogCovers';
import { offerUpdateOnStart } from '../src/updates';
import { OtaRunner } from '../src/ota';
import { registerBackgroundRefresh } from '../src/background';
import { COLORS } from '../src/components/Icon';
import { ThemeRoot, useTheme, useThemeKey } from '../src/theme';
import { useFold } from '../src/layout';

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

/** Keeps matched catalog covers on the phone after each library change (M80). */
function CatalogCoverSync() {
  const { version, refresh } = useLibrary();
  useEffect(() => syncCatalogCovers(refresh), [version, refresh]);
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
  const reduced = useReducedMotion();
  const theme = useTheme();
  // A new theme draws the screens again, as a new language does.
  const look = `${language} ${useThemeKey()}`;
  const pathname = usePathname();
  const hinge = useFold();
  // The full-screen player and car mode cover the whole window, across the hinge.
  const fold = pathname === '/player' || pathname === '/car' ? ({ kind: 'none' } as const) : hinge;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Before anything reads or saves: the profile this device used last.
  const profileLoaded = useMemo(() => {
    if (ready) loadActiveProfile();
    return ready;
  }, [ready]);
  useEffect(() => {
    if (ready) startDiagnostics();
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
    <ThemeRoot>
      <QueryClientProvider client={queryClient}>
        <PlayerProvider>
          <AddonSync />
          <DownloadSync />
          <SilenceSync />
          <PodcastSync />
          <CatalogCoverSync />
          <ClipStop />
          <SyncRunner />
          <OtaRunner />
          <DeviceRunner />
          {/*
            On a wide screen the player stands at the end, beside whichever screen is open, with
            a book's page between them on a very wide one. Around a foldable's hinge the hinge
            splits them instead, and nothing is drawn under it (M113).
          */}
          <BadgeSourceProvider>
            <View
              className={`flex-1 bg-night ${fold.kind === 'tabletop' ? 'flex-col' : 'flex-row'}`}
            >
              <View
                style={
                  fold.kind === 'book'
                    ? { width: I18nManager.isRTL ? windowWidth - fold.end : fold.start }
                    : fold.kind === 'tabletop'
                      ? { height: fold.start }
                      : { flex: 1 }
                }
              >
                <Stack
                  key={look}
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: COLORS.night },
                    ...(reduced ? { animation: 'none' } : {}),
                  }}
                >
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen
                    name="player"
                    options={{
                      presentation: 'modal',
                      animation: reduced ? 'none' : 'slide_from_bottom',
                    }}
                  />
                  <Stack.Screen name="who" options={{ presentation: 'modal' }} />
                  <Stack.Screen name="car" options={{ animation: reduced ? 'none' : 'fade' }} />
                </Stack>
              </View>
              {fold.kind !== 'none' && (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={
                    fold.kind === 'book'
                      ? { width: fold.end - fold.start }
                      : { height: fold.end - fold.start }
                  }
                />
              )}
              <DetailPane key={`detail ${look}`} />
              {fold.kind === 'tabletop' ? (
                <PlayerBelow key={look} height={windowHeight - fold.end} />
              ) : (
                <PlayerPane key={look} />
              )}
            </View>
          </BadgeSourceProvider>
          <ShortcutsHost key={look} />
          <InstalledAppHost />
          <HandoffBanner />
          <DialogHost />
          <AddonReviewHost />
          <SandboxHost />
          <ProfileGate />
          <StatusBar style={theme.dark ? 'light' : 'dark'} />
        </PlayerProvider>
      </QueryClientProvider>
    </ThemeRoot>
  );
}
