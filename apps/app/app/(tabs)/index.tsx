import { browseCatalogs, continueListening, getProfile, listProfiles } from '@lelap/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SHOWN_TYPES, syncAddonsNow, useAddons } from '../../src/addons';
import { Avatar } from '../../src/components/Avatar';
import { CatalogRow } from '../../src/components/CatalogRow';
import { ContinueCard } from '../../src/components/ContinueCard';
import { db } from '../../src/db';
import { openCatalog, openItem } from '../../src/navigation';
import { playBook, useLibrary } from '../../src/player';
import { profileId } from '../../src/profile';

export default function HomeScreen() {
  const { version, refresh } = useLibrary();
  // `version` is the signal to re-read the database.
  const profiles = useMemo(() => listProfiles(db), [version]);
  const me = useMemo(() => getProfile(db, profileId), [version]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const addons = useAddons();
  const [refreshing, setRefreshing] = useState(false);

  // `version` is the signal to re-read the database.
  const next = useMemo(() => continueListening(db, profileId), [version]);
  const rows = useMemo(() => browseCatalogs(addons, SHOWN_TYPES), [addons]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncAddonsNow();
      refresh();
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, refresh]);

  const resume = async () => {
    if (!next) return;
    try {
      await playBook(next.id);
      router.push('/player');
    } catch (error) {
      Alert.alert('Cannot play', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-night"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 24, gap: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
          tintColor="#f5b041"
        />
      }
    >
      <View className="flex-row items-center justify-between px-4">
        <Text className="text-3xl font-semibold text-paper">Lelap</Text>
        <View className="flex-row items-center gap-4">
          {profiles.length > 1 && (
            <Pressable
              onPress={() => router.push('/who')}
              hitSlop={8}
              accessibilityLabel="Switch profile"
            >
              <Avatar avatar={me?.avatar ?? null} name={me?.name ?? ''} size={30} />
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
            <Text className="text-2xl text-muted">⚙</Text>
          </Pressable>
        </View>
      </View>
      {next && <ContinueCard book={next} onPress={() => void resume()} />}
      {rows.map((ref) => (
        <CatalogRow
          key={`${ref.addon.url} ${ref.catalog.type} ${ref.catalog.id}`}
          catalogRef={ref}
          onOpen={(meta) => openItem(router, meta)}
          onMore={() => openCatalog(router, ref.addon.url, ref.catalog.id)}
        />
      ))}
      {rows.length === 0 && (
        <View className="mx-4 gap-2 rounded-xl border border-line p-4">
          <Text className="text-base text-paper">No catalogs yet</Text>
          <Text className="text-sm text-muted">
            Catalogs come from add-ons. Pull down to try again, or add one in Settings → Add-ons.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
