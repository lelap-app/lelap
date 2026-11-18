import {
  getSeries,
  type LibraryBook,
  moveInSeries,
  type SeriesBook,
  setSeriesOrder,
} from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { READABLE, useWide } from '../src/layout';
import { openPlayer } from '../src/navigation';
import { BookActions } from '../src/components/BookActions';
import { BookRow } from '../src/components/BookRow';
import { COLORS, IconButton } from '../src/components/Icon';
import { EmptyState } from '../src/components/Lori';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { TextButton } from '../src/components/TextButton';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { playBook, useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { bookNumber, useFindVolume } from '../src/series';

/** A book of the series, or a number no book in the library has. */
type Row = { book: SeriesBook } | { missing: number };

const rowKey = (row: Row) => ('book' in row ? row.book.book.id : `missing:${row.missing}`);

/**
 * Gaps go where their number belongs in the usual order; in the listener's own order, which
 * numbers no longer decide, they follow the books.
 */
function rowsOf(books: SeriesBook[], missing: number[], ordered: boolean): Row[] {
  if (ordered) return [...books.map((book) => ({ book })), ...missing.map((n) => ({ missing: n }))];
  const rows: Row[] = [];
  const gaps = [...missing];
  for (const book of books) {
    while (gaps.length > 0 && book.number !== null && (gaps[0] ?? 0) < book.number) {
      rows.push({ missing: gaps.shift() ?? 0 });
    }
    rows.push({ book });
  }
  return [...rows, ...gaps.map((n) => ({ missing: n }))];
}

/** A series in the library (M109): its books in reading order and the numbers it lacks. */
export default function SeriesScreen() {
  const params = useLocalSearchParams<{ key?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const { version, refresh } = useLibrary();
  const [actionBook, setActionBook] = useState<LibraryBook | null>(null);
  const [reordering, setReordering] = useState(false);
  const { find, looking } = useFindVolume();

  // `version` is the signal to re-read the database.
  const series = useMemo(
    () => (params.key ? getSeries(db, profileId, params.key) : null),
    [params.key, version],
  );
  const rows = useMemo(
    () => (series ? rowsOf(series.books, series.missing, series.ordered) : []),
    [series],
  );

  const open = useCallback(
    async (book: LibraryBook) => {
      if (book.missing) {
        showAlert(
          t('Files not found'),
          t('Lelap keeps your place until the files are back in the folder.'),
        );
        return;
      }
      try {
        await playBook(book.id);
        openPlayer(router);
      } catch (error) {
        showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));
      }
    },
    [router],
  );

  const move = (book: SeriesBook, by: number) => {
    if (!series) return;
    const at = series.books.indexOf(book);
    moveInSeries(db, profileId, series.key, book.book.id, at + by, Date.now());
    refresh();
  };

  const count = series?.books.length ?? 0;
  const finished = series?.books.filter((b) => b.book.finishedAt !== null).length ?? 0;
  const summary = series
    ? [
        count === 1 ? t('1 book') : t('{n} books', { n: count }),
        finished > 0 ? t('{n} finished', { n: finished }) : null,
        series.missing.length === 1
          ? t('1 missing')
          : series.missing.length > 1
            ? t('{n} missing', { n: series.missing.length })
            : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <View className="flex-1 bg-night" style={{ paddingTop: insets.top + 4 }}>
      <FlatList
        data={rows}
        keyExtractor={rowKey}
        contentContainerStyle={{ paddingBottom: 24, ...(wide ? READABLE : {}) }}
        ListHeaderComponent={
          <View className="gap-2 px-4 pb-3">
            <View className="-ms-2 self-start">
              <IconButton
                name="back"
                label={t('Back')}
                color={COLORS.soft}
                onPress={() => router.back()}
              />
            </View>
            {series && (
              <>
                <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
                  {series.name}
                </Text>
                {series.author && <Text className="text-base text-soft">{series.author}</Text>}
                <Text className="text-sm text-muted">{summary}</Text>
                {count > 1 && (
                  <View className="flex-row flex-wrap gap-x-4">
                    <TextButton
                      text={reordering ? t('Done') : t('Change the order')}
                      strong={reordering}
                      onPress={() => setReordering(!reordering)}
                      className="items-start"
                    />
                    {series.ordered && (
                      <TextButton
                        text={t('Order by number')}
                        tone="muted"
                        onPress={() => {
                          setSeriesOrder(db, profileId, series.key, [], Date.now());
                          refresh();
                        }}
                      />
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={t('No books in this series.')}
            hint={t('Lori looked everywhere in your library.')}
          />
        }
        renderItem={({ item }) => {
          if ('missing' in item) {
            return (
              <View className="min-h-16 flex-row items-center gap-3 px-4 py-2">
                {/* An empty cover's outline, so the gap reads as a place in the row of books. */}
                <View className="h-14 w-14 items-center justify-center rounded-md border border-dashed border-line">
                  <Text className="text-sm text-muted">{item.missing}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-muted">
                    {t('Book {n} is not in your library.', { n: item.missing })}
                  </Text>
                </View>
                {series &&
                  (looking === item.missing ? (
                    <ActivityIndicator color="#f5b041" className="min-h-12 px-3" />
                  ) : (
                    <TextButton
                      text={t('Look for it')}
                      accessibilityLabel={t('Look for book {n} in your add-ons', {
                        n: item.missing,
                      })}
                      onPress={() => void find(series, item.missing)}
                    />
                  ))}
              </View>
            );
          }
          const entry = item.book;
          const at = series?.books.indexOf(entry) ?? 0;
          const label = entry.position ? bookNumber(entry.position) : undefined;
          // While reordering, a plain row leaves room for the arrows on a 320-point screen.
          if (reordering) {
            return (
              <View className="min-h-16 flex-row items-center pe-2">
                <View className="flex-1 gap-1 py-2 ps-4">
                  <Text numberOfLines={2} className="text-base text-paper">
                    {entry.book.title}
                  </Text>
                  {label && (
                    <Text numberOfLines={1} className="text-sm text-muted">
                      {label}
                    </Text>
                  )}
                </View>
                <IconButton
                  name="up"
                  label={t('Move up')}
                  size={20}
                  color={at === 0 ? COLORS.line : COLORS.soft}
                  onPress={() => at > 0 && move(entry, -1)}
                />
                <IconButton
                  name="down"
                  label={t('Move down')}
                  size={20}
                  color={at === count - 1 ? COLORS.line : COLORS.soft}
                  onPress={() => at < count - 1 && move(entry, 1)}
                />
              </View>
            );
          }
          return (
            <BookRow
              book={entry.book}
              {...(label ? { note: label } : {})}
              onOpen={(b) => void open(b)}
              onLongPress={setActionBook}
            />
          );
        }}
      />
      <BookActions book={actionBook} onClose={() => setActionBook(null)} onChanged={refresh} />
      <MiniPlayer />
    </View>
  );
}
