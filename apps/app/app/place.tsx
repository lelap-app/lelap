import { findPlaceBook, getBook, parsePlace, placeQuery } from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookCover, coverUri } from '../src/components/BookCover';
import { COLORS, IconButton } from '../src/components/Icon';
import { TextButton } from '../src/components/TextButton';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { formatClock } from '../src/format';
import { t } from '../src/i18n';
import { READABLE } from '../src/layout';
import { openPlayer } from '../src/navigation';
import { playAt, useLibrary } from '../src/player';
import { profileId } from '../src/profile';

// Only a browser on an Android phone may have the app to hand the link to.
const androidBrowser =
  Platform.OS === 'web' && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/**
 * A shared place (M85), from `/place?t=…&at=…` on the web or `lelap://place?…`: which book and
 * where. It plays the listener's own copy; the link never carries audio.
 */
export default function PlaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version } = useLibrary();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  // Keyed by the query, since the params object may be new on every render.
  const query = JSON.stringify(params);
  const place = useMemo(() => parsePlace(params), [query]);
  // `version` is the signal to re-read the database: a scan may bring the book.
  const book = useMemo(() => {
    const id = place ? findPlaceBook(db, profileId, place) : null;
    return id ? getBook(db, profileId, id) : null;
  }, [place, version]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const play = () => {
    if (!book || !place) return;
    void playAt(book.book.id, place.atMs)
      .then(() => openPlayer(router))
      .catch((error: unknown) =>
        showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error)),
      );
  };

  return (
    <ScrollView
      className="flex-1 bg-night"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 16,
        gap: 16,
        ...READABLE,
      }}
    >
      <View className="-ms-2 self-start">
        <IconButton name="back" label={t('Back')} color={COLORS.soft} onPress={back} />
      </View>
      {!place ? (
        <Text className="text-soft">{t('This link does not name a place in a book.')}</Text>
      ) : (
        <>
          <View className="flex-row items-center gap-4">
            {book && <BookCover uri={coverUri(book.book)} title={book.book.title} size={96} />}
            <View className="flex-1 gap-1">
              <Text accessibilityRole="header" className="text-2xl font-semibold text-paper">
                {place.title}
              </Text>
              {place.author !== null && <Text className="text-soft">{place.author}</Text>}
              <Text className="text-amber">
                {place.toMs === null
                  ? t('At {time}', { time: formatClock(place.atMs) })
                  : t('From {start} to {end}', {
                      start: formatClock(place.atMs),
                      end: formatClock(place.toMs),
                    })}
              </Text>
            </View>
          </View>
          {book ? (
            <View className="gap-2">
              {book.book.title !== place.title && (
                <Text className="text-sm text-muted">
                  {t('In your library as “{title}”.', { title: book.book.title })}
                </Text>
              )}
              <Pressable
                onPress={play}
                accessibilityRole="button"
                className="min-h-12 items-center justify-center rounded-full bg-amber px-6 active:opacity-80"
              >
                <Text className="font-semibold text-ink">
                  {t('Play from {time}', { time: formatClock(place.atMs) })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-2">
              <Text className="text-soft">
                {t(
                  'This book is not in your library. The link only says where in the book to listen; the audio comes from your own copy.',
                )}
              </Text>
              {place.work && (
                <TextButton
                  className="self-start"
                  text={t('Look for it in the catalog')}
                  onPress={() =>
                    router.push({
                      pathname: '/item',
                      params: { type: place.work?.type ?? '', id: place.work?.id ?? '' },
                    })
                  }
                />
              )}
            </View>
          )}
          {androidBrowser && (
            <TextButton
              className="self-start"
              text={t('Open in the Lelap app')}
              onPress={() => void Linking.openURL(`lelap://place?${placeQuery(place)}`)}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}
