import {
  getSeries,
  type LibraryBook,
  missingCount,
  moveInSeries,
  type SeriesBook,
  type SeriesRow,
  seriesRows,
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
import { IconButton } from '../src/components/Icon';
import { EmptyState } from '../src/components/Lori';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { TextButton } from '../src/components/TextButton';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { playBook, useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { bookNumber, useFindVolume, useSeriesList } from '../src/series';
import { useColors } from '../src/theme';

const rowKey = (row: SeriesRow, index: number) =>
  row.kind === 'book'
    ? row.book.book.id
    : row.kind === 'gap'
      ? `gap:${row.number}`
      : `volume:${row.volume.externalIds?.wikidata ?? row.title}:${index}`;

/** Every title a listed book goes by, the one shown first: what Look for it searches with. */
const titlesOf = (row: Extract<SeriesRow, { kind: 'volume' }>) => [
  ...new Set([row.title, row.volume.title, ...Object.values(row.volume.titles ?? {})]),
];

/**
 * A series (M109): with the whole series from the add-ons (M127), every book in order, the
 * library's to play and the others by title to look for; else the library's books and gaps.
 */
export default function SeriesScreen() {
  const colors = useColors();
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
    () => (params.key ? getSeries(db, profileId, params.key, version) : null),
    [params.key, version],
  );
  const lookup = useMemo(
    () =>
      series
        ? {
            key: series.key,
            name: series.name,
            author: series.author,
            bookKeys: series.books.map((b) => b.bookKey),
          }
        : null,
    [series],
  );
  const { list, asking } = useSeriesList(lookup);
  const rows = useMemo(() => (series ? seriesRows(series, list) : []), [series, list]);

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
  const missing = missingCount(rows);
  const summary = series
    ? [
        count === 1 ? t('1 book') : t('{n} books', { n: count }),
        finished > 0 ? t('{n} finished', { n: finished }) : null,
        missing === 1 ? t('1 missing') : missing > 1 ? t('{n} missing', { n: missing }) : null,
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
                color={colors.soft}
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
                {asking && !list && (
                  <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
                    {t('Looking up the whole series in your add-ons…')}
                  </Text>
                )}
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
        renderItem={({ item, index }) => {
          if (item.kind === 'gap') {
            const id = `gap:${item.number}`;
            return (
              <View className="min-h-16 flex-row items-center gap-3 px-4 py-2">
                {/* An empty cover's outline, so the gap reads as a place in the row of books. */}
                <View className="h-14 w-14 items-center justify-center rounded-md border border-dashed border-line">
                  <Text className="text-sm text-muted">{item.number}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-muted">
                    {t('Book {n} is not in your library.', { n: item.number })}
                  </Text>
                </View>
                {series &&
                  (looking === id ? (
                    <ActivityIndicator color={colors.amber} className="min-h-12 px-3" />
                  ) : (
                    <TextButton
                      text={t('Look for it')}
                      accessibilityLabel={t('Look for book {n} in your add-ons', {
                        n: item.number,
                      })}
                      onPress={() => void find(series, { number: item.number, id })}
                    />
                  ))}
              </View>
            );
          }
          if (item.kind === 'volume') {
            const id = rowKey(item, index);
            const position = item.volume.position;
            const second = [
              position ? bookNumber(position) : null,
              item.year !== null ? String(item.year) : null,
              t('Not in your library'),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <View className="min-h-16 flex-row items-center gap-3 px-4 py-2">
                <View className="h-14 w-14 items-center justify-center rounded-md border border-dashed border-line">
                  <Text className="text-sm text-muted">{position ?? ''}</Text>
                </View>
                <View className="flex-1 gap-1">
                  <Text numberOfLines={2} className="text-base text-soft">
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} className="text-sm text-muted">
                    {second}
                  </Text>
                </View>
                {series &&
                  (looking === id ? (
                    <ActivityIndicator color={colors.amber} className="min-h-12 px-3" />
                  ) : (
                    <TextButton
                      text={t('Look for it')}
                      accessibilityLabel={t('Look for {title} in your add-ons', {
                        title: item.title,
                      })}
                      onPress={() =>
                        void find(series, { number: item.number, titles: titlesOf(item), id })
                      }
                    />
                  ))}
              </View>
            );
          }
          const entry = item.book;
          const at = series?.books.indexOf(entry) ?? 0;
          const position = entry.position ?? item.volume?.position;
          const label = position ? bookNumber(position) : undefined;
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
                  label={t('Move {title} up', { title: entry.book.title })}
                  size={20}
                  color={at === 0 ? colors.line : colors.soft}
                  onPress={() => at > 0 && move(entry, -1)}
                />
                <IconButton
                  name="down"
                  label={t('Move {title} down', { title: entry.book.title })}
                  size={20}
                  color={at === count - 1 ? colors.line : colors.soft}
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
