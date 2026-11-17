import {
  browseCatalogs,
  continueListening,
  getProfile,
  listDownloads,
  listProfiles,
  WANT_TO_READ,
} from '@lelap/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '../../src/dialog';
import { COLORS, Icon, IconButton } from '../../src/components/Icon';
import { SHOWN_TYPES, syncAddonsNow, useAddons } from '../../src/addons';
import { Avatar } from '../../src/components/Avatar';
import { CatalogRow } from '../../src/components/CatalogRow';
import { ContinueCard } from '../../src/components/ContinueCard';
import { db } from '../../src/db';
import { formatBytes } from '../../src/format';
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
  const offline = useMemo(() => {
    const done = listDownloads(db).filter((d) => d.state === 'done');
    return { count: done.length, bytes: done.reduce((sum, d) => sum + d.bytesTotal, 0) };
  }, [version]);
  const allRows = useMemo(() => browseCatalogs(addons, SHOWN_TYPES), [addons]);
  // Shelves of books the listener wants to read (from a reading tracker's add-on) come first.
  const wanted = allRows.filter((ref) => ref.catalog.shelf === WANT_TO_READ);
  const rows = allRows.filter((ref) => ref.catalog.shelf !== WANT_TO_READ);

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
      showAlert('Cannot play', error instanceof Error ? error.message : String(error));
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
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.push('/addons')}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full border border-line px-3 py-2 active:bg-raised"
          >
            <View
              className={`h-1.5 w-1.5 rounded-full ${addons.length > 0 ? 'bg-ok' : 'bg-muted'}`}
            />
            <Text className="text-xs text-soft">
              {addons.length === 1 ? '1 add-on' : `${addons.length} add-ons`}
            </Text>
          </Pressable>
          {profiles.length > 1 && (
            <Pressable
              onPress={() => router.push('/who')}
              hitSlop={8}
              accessibilityLabel="Switch profile"
            >
              <Avatar avatar={me?.avatar ?? null} name={me?.name ?? ''} size={30} />
            </Pressable>
          )}
          <IconButton
            name="stats"
            label="Listening stats"
            color={COLORS.soft}
            onPress={() => router.push('/stats')}
          />
          <IconButton
            name="settings"
            label="Settings"
            color={COLORS.soft}
            onPress={() => router.push('/settings')}
          />
        </View>
      </View>
      {next && <ContinueCard book={next} onPress={() => void resume()} />}
      {offline.count > 0 && (
        <Pressable
          onPress={() => router.push('/downloads')}
          accessibilityRole="button"
          className="mx-4 flex-row items-center gap-3 rounded-xl border border-line px-4 py-3 active:bg-raised"
        >
          <Icon name="check" color={COLORS.amber} />
          <View className="flex-1 gap-0.5">
            <Text className="font-semibold text-paper">Ready for offline</Text>
            <Text className="text-xs text-muted">
              {offline.count === 1 ? '1 download' : `${offline.count} downloads`} ·{' '}
              {formatBytes(offline.bytes)} on this {Platform.OS === 'web' ? 'device' : 'phone'}
            </Text>
          </View>
          <Icon name="forward" size={20} color={COLORS.muted} />
        </Pressable>
      )}
      {wanted.map((ref) => (
        <CatalogRow
          key={`${ref.addon.url} ${ref.catalog.type} ${ref.catalog.id}`}
          catalogRef={ref}
          title={wanted.length > 1 ? `Want to read · ${ref.addon.manifest.name}` : 'Want to read'}
          onOpen={(meta) => openItem(router, meta)}
          onMore={() => openCatalog(router, ref.addon.url, ref.catalog.id)}
        />
      ))}
      {rows.map((ref) => (
        <CatalogRow
          key={`${ref.addon.url} ${ref.catalog.type} ${ref.catalog.id}`}
          catalogRef={ref}
          onOpen={(meta) => openItem(router, meta)}
          onMore={() => openCatalog(router, ref.addon.url, ref.catalog.id)}
        />
      ))}
      {allRows.length === 0 && (
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
