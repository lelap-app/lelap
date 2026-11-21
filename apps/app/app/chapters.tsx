import { chaptersOf, getBook, parseTime, setOwnChapters, toBookPosition } from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../src/components/EmptyState';
import { IconButton } from '../src/components/Icon';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { TextField } from '../src/components/TextField';
import { TextButton } from '../src/components/TextButton';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { formatClock } from '../src/format';
import { t } from '../src/i18n';
import { READABLE } from '../src/layout';
import { updateChapters, useLibrary, usePlayerState } from '../src/player';
import { profileId } from '../src/profile';
import { useColors } from '../src/theme';

type Row = {
  key: number;
  title: string;
  /** The start as typed. */
  time: string;
  /** The start it had, kept to the millisecond while its text is unchanged. */
  startMs: number | null;
  /** Found from silences: untitled, it is a “Part”. */
  found: boolean;
};

let nextKey = 0;
const row = (title: string, startMs: number, found = false): Row => ({
  key: ++nextKey,
  title,
  time: formatClock(startMs),
  startMs,
  found,
});

const startOf = (r: Row): number | null =>
  r.startMs !== null && r.time === formatClock(r.startMs) ? r.startMs : parseTime(r.time);

/**
 * Edit a book's chapters (M85): rename, move, add and remove. What is saved becomes the
 * listener's own chapters, synced and kept across rescans; Reset in the chapters sheet goes back.
 */
export default function EditChaptersScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const state = usePlayerState();
  const { refresh } = useLibrary();
  const { book: bookId = '' } = useLocalSearchParams<{ book?: string }>();
  const detail = useMemo(() => getBook(db, profileId, bookId), [bookId]);
  // As saved: an untitled chapter keeps an empty field, its name only the placeholder.
  const [rows, setRows] = useState<Row[]>(() =>
    detail ? chaptersOf(db, profileId, bookId).map((c) => row(c.title, c.startMs, c.found)) : [],
  );
  // Where the player is in this book, for a chapter that starts here.
  const here =
    detail && state.bookId === bookId && state.fileLocation
      ? toBookPosition(detail.files, state.fileLocation, state.positionMs)
      : null;

  if (!detail) {
    return (
      <View
        style={{ paddingTop: insets.top + 8, paddingHorizontal: 16 }}
        className="flex-1 bg-night"
      >
        <ScreenHeader />
        <EmptyState title={t('This book is no longer in the library.')} />
      </View>
    );
  }

  const change = (key: number, set: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...set } : r)));

  const add = () => {
    const last = rows.at(-1);
    const at = here ?? (last ? (startOf(last) ?? 0) + 60_000 : 0);
    // A streamed book's length may not be known yet; then nothing caps the start.
    const end = detail.book.durationMs > 0 ? detail.book.durationMs - 1 : at;
    setRows((list) => [...list, row('', Math.min(at, end))]);
  };

  const save = () => {
    const bad = rows.find((r) => startOf(r) === null);
    if (bad) {
      showAlert(
        t('That time is not one Lelap can read'),
        t('Type a time such as 2:14:30, 14:30 or 90 (minutes).'),
      );
      return;
    }
    setOwnChapters(
      db,
      profileId,
      bookId,
      rows.map((r) => ({ title: r.title, startMs: startOf(r) ?? 0, found: r.found })),
      detail.book.durationMs,
      Date.now(),
    );
    refresh();
    // A playing book gets them too: the lock screen title and a chapter timer follow them.
    void updateChapters(bookId).catch(() => {});
    router.back();
  };

  return (
    <View className="flex-1 bg-night">
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.key)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 16,
          ...READABLE,
        }}
        ListHeaderComponent={
          <ScreenHeader
            title={t('Edit chapters')}
            action={<TextButton text={t('Save')} onPress={save} strong />}
          >
            <Text numberOfLines={2} className="text-soft">
              {detail.book.title}
            </Text>
            <Text className="text-detail text-muted">
              {t(
                'Rename a chapter, change where it starts, or add and remove chapters. They become your own chapters for this book, on your other devices too, and stay when the library is scanned again.',
              )}
            </Text>
          </ScreenHeader>
        }
        ListEmptyComponent={<EmptyState title={t('No chapters.')} />}
        renderItem={({ item, index }) => (
          <View className="flex-row items-center gap-2 border-b border-line py-2">
            <TextField
              value={item.title}
              onChangeText={(title) => change(item.key, { title })}
              placeholder={
                item.found ? t('Part {n}', { n: index + 1 }) : t('Chapter {n}', { n: index + 1 })
              }
              accessibilityLabel={t('Name of chapter {n}', { n: index + 1 })}
              className="flex-1"
            />
            <TextField
              value={item.time}
              onChangeText={(time) => change(item.key, { time })}
              accessibilityLabel={t('Start of chapter {n}', { n: index + 1 })}
              keyboardType="numbers-and-punctuation"
              className="w-24"
              // TextField has no error look; a time Lelap can't read keeps its red border.
              {...(startOf(item) === null ? { style: { borderColor: colors.danger } } : {})}
            />
            {here !== null && (
              <TextButton
                text={t('Now')}
                accessibilityLabel={t('Start chapter {n} here', { n: index + 1 })}
                onPress={() => change(item.key, { time: formatClock(here), startMs: here })}
              />
            )}
            <IconButton
              name="close"
              label={t('Remove chapter {n}', { n: index + 1 })}
              color={colors.muted}
              onPress={() => setRows((list) => list.filter((r) => r.key !== item.key))}
            />
          </View>
        )}
        ListFooterComponent={
          <View className="flex-row flex-wrap items-center justify-between gap-2 pt-3">
            <TextButton
              text={here !== null ? t('Add a chapter here') : t('Add a chapter')}
              onPress={add}
            />
            <Text className="text-caption text-muted">
              {t('Chapters are put in order of their start when saved.')}
            </Text>
          </View>
        }
      />
    </View>
  );
}
