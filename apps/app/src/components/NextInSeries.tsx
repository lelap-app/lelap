import { mainSeriesOf, nextInWholeSeries } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { hint } from '../a11y';
import { db } from '../db';
import { showAlert } from '../dialog';
import { currentLanguage, t } from '../i18n';
import { playBook, useLibrary } from '../player';
import { profileId } from '../profile';
import { bookNumber, useFindVolume, useSeriesList } from '../series';
import { BookCover, coverUri } from './BookCover';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

/**
 * When a book has ended (M109): the next book of its series, to play from the library, or the
 * next number to look for in the add-ons when the library lacks it.
 */
export function NextInSeries({
  bookId,
  ended,
  className = '',
}: {
  bookId: string;
  ended: boolean;
  className?: string;
}) {
  const colors = useColors();
  const router = useRouter();
  const { version, refresh } = useLibrary();
  const { find, looking } = useFindVolume();
  // `version` is the signal to re-read the database.
  const main = useMemo(
    () => (ended ? mainSeriesOf(db, profileId, bookId, version) : null),
    [ended, bookId, version],
  );
  const lookup = useMemo(
    () =>
      main
        ? {
            key: main.key,
            name: main.name,
            author: main.author,
            bookKeys: main.books.map((b) => b.bookKey),
          }
        : null,
    [main],
  );
  // The whole series (M127) names the next book by its title; asked once, then kept.
  const { list } = useSeriesList(lookup);
  const next = useMemo(
    () => (ended ? nextInWholeSeries(db, profileId, bookId, currentLanguage(), version) : null),
    // `list` is the signal that a new answer was kept.
    [ended, bookId, version, list],
  );
  if (!next) return null;

  const openSeries = () => router.push({ pathname: '/series', params: { key: next.series.key } });
  const heading = t('Next in {series}', { series: next.series.name });

  if (next.book) {
    const book = next.book;
    const play = async () => {
      try {
        await playBook(book.id);
        refresh();
      } catch (error) {
        showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));
      }
    };
    return (
      <View
        accessibilityLiveRegion="polite"
        className={`gap-3 rounded-xl border border-line bg-raised p-3 ${className}`}
      >
        <Pressable
          onPress={openSeries}
          accessibilityRole="button"
          {...hint(t('Opens the series'))}
          className="flex-row items-center gap-3"
        >
          <BookCover uri={coverUri(book)} title={book.title} size={48} />
          <View className="flex-1">
            <Text className="text-caption uppercase tracking-widest text-muted">{heading}</Text>
            <Text numberOfLines={2} className="text-paper">
              {next.position ? `${bookNumber(next.position)} · ${book.title}` : book.title}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => void play()}
          accessibilityRole="button"
          className="min-h-12 items-center justify-center rounded-lg bg-amber px-4 py-2 active:opacity-80"
        >
          <Text className="font-semibold text-ink">{t('Play next book')}</Text>
        </Pressable>
      </View>
    );
  }

  const number = next.number;
  if (number === null) return null;
  const title = next.title;
  const id = `next:${number}`;
  return (
    <View
      accessibilityLiveRegion="polite"
      className={`gap-1 rounded-xl border border-line bg-raised p-3 ${className}`}
    >
      <Text className="text-caption uppercase tracking-widest text-muted">{heading}</Text>
      {title ? (
        <>
          <Text numberOfLines={2} className="text-paper">
            {[next.position ? bookNumber(next.position) : null, title].filter(Boolean).join(' · ')}
          </Text>
          <Text className="text-detail text-muted">
            {[next.year !== undefined ? String(next.year) : null, t('Not in your library')]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </>
      ) : (
        <Text className="text-paper">
          {t('Book {n} is not in your library.', { n: next.position ?? String(number) })}
        </Text>
      )}
      <View className="flex-row flex-wrap items-center gap-x-4">
        {looking === id ? (
          <ActivityIndicator color={colors.amber} className="min-h-12" />
        ) : (
          <TextButton
            text={t('Look in your add-ons')}
            strong
            onPress={() =>
              void find(next.series, { number, id, ...(title ? { titles: [title] } : {}) })
            }
          />
        )}
        <TextButton text={t('Open the series')} tone="muted" onPress={openSeries} />
      </View>
    </View>
  );
}
