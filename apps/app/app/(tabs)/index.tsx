import {
  browseCatalogs,
  continueListening,
  getProfile,
  getSettings,
  libraryIsEmpty,
  listDownloads,
  listProfiles,
  setSetting,
  setWantedAlertsAsked,
  WANT_TO_READ,
  wantedAlertsAsked,
} from '@lelap/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { showAlert } from '../../src/dialog';
import { Icon, IconButton } from '../../src/components/Icon';
import { SHOWN_TYPES, syncAddonsNow, useAddons } from '../../src/addons';
import { Avatar } from '../../src/components/Avatar';
import { CatalogRow } from '../../src/components/CatalogRow';
import { ImportedWantedRow } from '../../src/components/ImportedWanted';
import { ContinueCard } from '../../src/components/ContinueCard';
import { db } from '../../src/db';
import { formatBytes } from '../../src/format';
import { openCatalog, openItem, openPlayer } from '../../src/navigation';
import { canNotify } from '../../src/platform/downloads';
import { playBook, useLibrary } from '../../src/player';
import { profileId } from '../../src/profile';
import { startupMark } from '../../src/startup';
import { Pill } from '../../src/components/Pill';
import { SuggestionRows } from '../../src/components/SuggestionRows';
import { TextButton } from '../../src/components/TextButton';
import { useColors } from '../../src/theme';

/**
 * Asks once, next to the want-to-read row, whether Lelap may say when a wanted book can be
 * played. Never at launch, and never again after an answer.
 */
function WantedAlertsHint({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const answer = async (allow: boolean) => {
    if (allow && Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    setWantedAlertsAsked(db, profileId, Date.now());
    onDone();
  };
  return (
    <View className="mx-4 flex-row items-center gap-3 rounded-xl border border-line px-4 py-3">
      <Icon name="bookmark" color={colors.amber} />
      <Text className="flex-1 text-sm text-soft">
        {t('Get a notification when a book you want to read can be played?')}
      </Text>
      <TextButton text={t('Not now')} tone="muted" onPress={() => void answer(false)} />
      <TextButton strong text={t('Allow')} onPress={() => void answer(true)} />
    </View>
  );
}

let homeMarked = false;
/** The first time Home is on screen, for the start's timings (M106). */
function markHome() {
  if (homeMarked) return;
  homeMarked = true;
  startupMark('home-drawn');
}

export default function HomeScreen() {
  const colors = useColors();
  const { version, refresh } = useLibrary();
  useEffect(markHome, []);
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
  // Nothing played and nothing of their own yet: say where books come from (M82).
  const empty = useMemo(
    () => !next && !me?.kids && libraryIsEmpty(db),
    // `version` is the signal to re-read the database.
    [next, me, version],
  );
  const offline = useMemo(() => {
    const done = listDownloads(db).filter((d) => d.state === 'done');
    return { count: done.length, bytes: done.reduce((sum, d) => sum + d.bytesTotal, 0) };
  }, [version]);
  // `version` is the signal to re-read the database.
  const suggest = useMemo(() => getSettings(db, profileId).homeSuggestions, [version]);
  const allRows = useMemo(() => browseCatalogs(addons, SHOWN_TYPES), [addons]);
  // Shelves of books the listener wants to read (from a reading tracker's add-on) come first.
  const wanted = allRows.filter((ref) => ref.catalog.shelf === WANT_TO_READ);
  const rows = allRows.filter((ref) => ref.catalog.shelf !== WANT_TO_READ);
  // Only Android has the background refresh that sends these.
  const askAlerts = useMemo(
    () =>
      Platform.OS === 'android' &&
      wanted.length > 0 &&
      !canNotify() &&
      !wantedAlertsAsked(db, profileId),
    // `version` is the signal to re-read the database.
    [wanted.length, version],
  );

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

  const hideSuggestions = () => {
    setSetting(db, profileId, 'homeSuggestions', false, Date.now());
    refresh();
    showAlert(t('Suggestions hidden'), t('Show them again in Settings → Catalogs.'));
  };

  const resume = async () => {
    if (!next) return;
    try {
      await playBook(next.id);
      openPlayer(router);
    } catch (error) {
      showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));
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
          tintColor={colors.amber}
        />
      }
    >
      <View className="flex-row flex-wrap items-center justify-between gap-y-2 px-4">
        <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
          {'Lelap'}
        </Text>
        <View className="flex-row items-center gap-2">
          <Pill
            onPress={() => router.push('/addons')}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 rounded-full border border-line px-3 py-2 active:bg-raised"
          >
            <View
              className={`h-1.5 w-1.5 rounded-full ${addons.length > 0 ? 'bg-ok' : 'bg-muted'}`}
            />
            <Text className="text-xs text-soft">
              {addons.length === 1 ? t('1 add-on') : t('{n} add-ons', { n: addons.length })}
            </Text>
          </Pill>
          {profiles.length > 1 && (
            <Pressable
              onPress={() => router.push('/who')}
              accessibilityRole="button"
              accessibilityLabel={t('Switch profile')}
              className="h-12 w-12 items-center justify-center"
            >
              <Avatar avatar={me?.avatar ?? null} name={me?.name ?? ''} size={30} />
            </Pressable>
          )}
          <IconButton
            name="stats"
            label={t('Listening stats')}
            color={colors.soft}
            onPress={() => router.push('/stats')}
          />
          <IconButton
            name="settings"
            label={t('Settings')}
            color={colors.soft}
            onPress={() => router.push('/settings')}
          />
        </View>
      </View>
      {next && <ContinueCard book={next} onPress={() => void resume()} />}
      {empty && (
        <View className="mx-4 gap-1 rounded-xl border border-line px-4 py-3">
          <Text className="text-base text-paper">{t('Nothing to continue yet')}</Text>
          <Text className="text-sm text-muted">
            {allRows.length > 0
              ? t('Pick a free book in the rows below, or add your own audiobooks in Library.')
              : t('Add your own audiobooks in Library.')}
          </Text>
          <TextButton
            className="self-start"
            text={t('Go to Library')}
            onPress={() => router.navigate('/library')}
          />
        </View>
      )}
      {offline.count > 0 && (
        <Pressable
          onPress={() => router.push('/downloads')}
          accessibilityRole="button"
          className="mx-4 flex-row items-center gap-3 rounded-xl border border-line px-4 py-3 active:bg-raised"
        >
          <Icon name="check" color={colors.amber} />
          <View className="flex-1 gap-0.5">
            <Text className="font-semibold text-paper">{t('Ready for offline')}</Text>
            <Text className="text-xs text-muted">
              {offline.count === 1 ? t('1 download') : t('{n} downloads', { n: offline.count })} ·{' '}
              {Platform.OS === 'web'
                ? t('{size} on this device', { size: formatBytes(offline.bytes) })
                : t('{size} on this phone', { size: formatBytes(offline.bytes) })}
            </Text>
          </View>
          <Icon name="forward" size={20} color={colors.muted} />
        </Pressable>
      )}
      {wanted.map((ref) => (
        <CatalogRow
          key={`${ref.addon.url} ${ref.catalog.type} ${ref.catalog.id}`}
          catalogRef={ref}
          title={
            wanted.length > 1
              ? `${t('Want to read')} · ${ref.addon.manifest.name}`
              : t('Want to read')
          }
          onOpen={(meta) => openItem(router, meta)}
          onMore={() => openCatalog(router, ref.addon.url, ref.catalog.id)}
        />
      ))}
      <ImportedWantedRow onOpen={(meta) => openItem(router, meta)} />
      {askAlerts && <WantedAlertsHint onDone={refresh} />}
      {suggest && (
        <SuggestionRows onOpen={(meta) => openItem(router, meta)} onHide={hideSuggestions} />
      )}
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
          <Text className="text-base text-paper">{t('No catalogs yet')}</Text>
          <Text className="text-sm text-muted">
            {t(
              'Catalogs come from add-ons. Pull down to try again, or add one in Settings → Add-ons.',
            )}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
