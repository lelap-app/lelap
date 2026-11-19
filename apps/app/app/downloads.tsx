import { type DownloadEntry, getSettings, listDownloads } from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { showAlert } from '../src/dialog';
import { IconButton } from '../src/components/Icon';
import { BookCover, coverUri } from '../src/components/BookCover';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { TextButton } from '../src/components/TextButton';
import { db } from '../src/db';
import {
  deleteDownload,
  describeDownload,
  startDownload,
  useDownloadStatuses,
} from '../src/downloads';
import { formatBytes } from '../src/format';
import * as native from '../src/platform/downloads';
import { useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { LIST_COLUMN } from '../src/layout';
import { useColors } from '../src/theme';

/** The storage overview: what Lelap keeps on the phone and the space left. */
export default function DownloadsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const statuses = useDownloadStatuses();
  // `version` is the signal to re-read the database.
  const entries = useMemo(() => listDownloads(db), [version]);
  const settings = useMemo(() => getSettings(db, profileId), [version]);
  const storage = useQuery({
    queryKey: ['storage', version, entries.length],
    queryFn: () => native.storage(),
    networkMode: 'always',
  });
  // Whether the browser keeps its storage when the disk runs low; Android always does.
  const kept = useQuery({
    queryKey: ['storage-kept', version],
    queryFn: native.storageKept,
    networkMode: 'always',
  });

  const act = (task: () => Promise<void>) =>
    void task()
      .catch((error: unknown) =>
        showAlert(t('Download'), error instanceof Error ? error.message : String(error)),
      )
      .finally(refresh);

  const showActions = (entry: DownloadEntry) => {
    const remove = {
      text: entry.state === 'done' ? t('Remove download') : t('Cancel download'),
      style: 'destructive' as const,
      onPress: () => act(() => deleteDownload(entry.bookId)),
    };
    const buttons =
      entry.state === 'failed'
        ? [
            remove,
            { text: t('Try again'), onPress: () => act(() => startDownload(entry.bookId, null)) },
          ]
        : [remove];
    showAlert(entry.title, entry.error ?? undefined, [
      { text: t('Close'), style: 'cancel' },
      ...buttons,
    ]);
  };

  const used = storage.data?.usedBytes ?? 0;
  const total = storage.data?.totalBytes ?? 0;

  return (
    <View className="flex-1 bg-night">
      <FlatList
        data={entries}
        keyExtractor={(e) => e.bookId}
        contentContainerStyle={{ ...LIST_COLUMN, paddingTop: insets.top + 8, paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="gap-4 px-4 pb-4">
            <View className="-ms-2 self-start">
              <IconButton
                name="back"
                label={t('Back')}
                color={colors.soft}
                onPress={() => router.back()}
              />
            </View>
            <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
              {t('Downloads')}
            </Text>
            {storage.data && (
              <View className="gap-2">
                <Text className="text-base text-soft">
                  {Platform.OS === 'web'
                    ? t('Lelap uses {used} · {free} free in this browser', {
                        used: formatBytes(used),
                        free: formatBytes(storage.data.freeBytes),
                      })
                    : t('Lelap uses {used} · {free} free on this phone', {
                        used: formatBytes(used),
                        free: formatBytes(storage.data.freeBytes),
                      })}
                </Text>
                <View className="h-2 flex-row overflow-hidden rounded-full bg-line">
                  <View
                    style={{
                      width: `${total > 0 ? ((total - storage.data.freeBytes) / total) * 100 : 0}%`,
                    }}
                    className="h-2 bg-soft"
                  />
                </View>
              </View>
            )}
            {native.RULES_APPLY ? (
              <Text className="text-sm text-muted">
                {`${[
                  settings.downloadOnWifiOnly ? t('Only on Wi-Fi') : t('On Wi-Fi and mobile data'),
                  settings.downloadWhileChargingOnly ? t('only while charging') : null,
                ]
                  .filter(Boolean)
                  .join(', ')}. ${t('Change this in Settings.')}`}
              </Text>
            ) : kept.data === false ? (
              <View className="flex-row items-center gap-4">
                <Text className="flex-1 text-sm text-muted">
                  {t(
                    'The browser may clear downloads when its disk runs low. Ask it to keep them, or install Lelap.',
                  )}
                </Text>
                <TextButton
                  text={t('Keep')}
                  onPress={() => void native.keepStorage().then(() => kept.refetch())}
                />
              </View>
            ) : kept.data ? (
              <Text className="text-sm text-muted">
                {t(
                  'Downloads stay in this browser until you remove them. They download while Lelap is open.',
                )}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text className="px-4 pt-8 text-center text-muted">
            {t(
              'Downloaded books play without a connection. Download one from its page or from the Library.',
            )}
          </Text>
        }
        renderItem={({ item: entry }) => {
          const view = describeDownload(entry, statuses.get(entry.bookId), settings);
          return (
            <Pressable
              onPress={() => showActions(entry)}
              accessibilityRole="button"
              className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
            >
              <BookCover uri={coverUri(entry)} title={entry.title} size={56} />
              <View className="flex-1 gap-1">
                <Text numberOfLines={2} className="text-base text-paper">
                  {entry.title}
                </Text>
                <Text
                  numberOfLines={2}
                  className={`text-sm ${view.failed ? 'text-danger' : 'text-muted'}`}
                >
                  {view.label}
                </Text>
                {view.progress !== null && (
                  <View className="h-1 overflow-hidden rounded-full bg-line">
                    <View style={{ width: `${view.progress * 100}%` }} className="h-1 bg-amber" />
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />
      <MiniPlayer />
    </View>
  );
}
