import { getDownload, getSettings } from '@lelap/core';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { showAlert } from '../dialog';
import { db } from '../db';
import { deleteDownload, describeDownload, useDownloadStatuses } from '../downloads';
import { formatBytes } from '../format';
import { useLibrary } from '../player';
import { profileId } from '../profile';
import { useColors } from '../theme';

/**
 * Download, its progress, or Remove download for a streamed book. [start] adds the book to the
 * library first when needed and starts the download.
 */
export function DownloadButton({
  bookId,
  sizeBytes,
  start,
}: {
  bookId: string | null;
  sizeBytes: number;
  start: () => Promise<void>;
}) {
  const colors = useColors();
  const { version, refresh } = useLibrary();
  const statuses = useDownloadStatuses();
  const [busy, setBusy] = useState(false);
  // `version` is the signal to re-read the database.
  const entry = useMemo(() => (bookId ? getDownload(db, bookId) : null), [bookId, version]);
  const status = bookId ? statuses.get(bookId) : undefined;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showAlert(t('Download'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!entry) {
    return (
      <Pressable
        disabled={busy}
        onPress={() => void run(start)}
        accessibilityRole="button"
        {...(busy ? { accessibilityLabel: t('Download') } : {})}
        className="min-h-12 items-center justify-center rounded-full border border-line py-3 active:bg-raised"
      >
        {busy ? (
          <ActivityIndicator color={colors.amber} />
        ) : (
          <Text className="text-body text-paper">
            {sizeBytes > 0 ? `${t('Download')} · ${formatBytes(sizeBytes)}` : t('Download')}
          </Text>
        )}
      </Pressable>
    );
  }

  const view = describeDownload(entry, status, getSettings(db, profileId));
  const remove = () =>
    showAlert(
      entry.state === 'done' ? t('Remove download?') : t('Cancel download?'),
      t('The book stays in your library and streams while online.'),
      [
        { text: t('Keep'), style: 'cancel' },
        {
          text: entry.state === 'done' ? t('Remove') : t('Cancel download'),
          style: 'destructive',
          onPress: () => void run(() => deleteDownload(entry.bookId)),
        },
      ],
    );
  const onPress = () => {
    if (!view.failed) return remove();
    showAlert(t('Download failed'), entry.error ?? undefined, [
      { text: t('Close'), style: 'cancel' },
      {
        text: t('Remove'),
        style: 'destructive',
        onPress: () => void run(() => deleteDownload(entry.bookId)),
      },
      { text: t('Try again'), onPress: () => void run(start) },
    ]);
  };

  return (
    <Pressable
      disabled={busy}
      onPress={onPress}
      accessibilityRole="button"
      className="gap-2 rounded-xl border border-line px-4 py-3 active:bg-raised"
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text numberOfLines={2} className={`flex-1 ${view.failed ? 'text-danger' : 'text-paper'}`}>
          {view.label}
        </Text>
        <Text className="text-amber">
          {view.failed ? t('Retry') : entry.state === 'done' ? t('Remove') : t('Cancel')}
        </Text>
      </View>
      {view.progress !== null && (
        <View className="h-1 overflow-hidden rounded-full bg-line">
          <View style={{ width: `${view.progress * 100}%` }} className="h-1 bg-amber" />
        </View>
      )}
    </Pressable>
  );
}
