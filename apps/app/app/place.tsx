import { findPlaceBook, findPlaceEpisode, getBook, parsePlace, placeQuery } from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookCover, coverUri } from '../src/components/BookCover';
import { Button } from '../src/components/Button';
import { LoadState } from '../src/components/LoadState';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { TextButton } from '../src/components/TextButton';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { formatClock } from '../src/format';
import { t } from '../src/i18n';
import { READABLE } from '../src/layout';
import { openPlayer } from '../src/navigation';
import { playClip } from '../src/clips';
import { playAt, useLibrary } from '../src/player';
import { playSharedEpisode } from '../src/podcasts';
import { profileId } from '../src/profile';

// Only a browser on an Android phone may have the app to hand the link to.
const androidBrowser =
  Platform.OS === 'web' && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/**
 * A shared place (M85), from `/place?t=…&at=…` on the web or `lelap://place?…`: which book and
 * where. It plays the listener's own copy; the link never carries audio. An episode's link (M88)
 * names its show's feed, which is fetched only when the listener taps Subscribe and play.
 */
export default function PlaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  // Keyed by the query, since the params object may be new on every render.
  const query = JSON.stringify(params);
  const place = useMemo(() => parsePlace(params), [query]);
  // `version` is the signal to re-read the database: a scan may bring the book.
  // A podcast episode (M88) is found by its feed and guid, a book by its title and IDs.
  const episode = useMemo(
    () => (place?.episode ? findPlaceEpisode(db, profileId, place.episode) : null),
    [place, version],
  );
  const book = useMemo(() => {
    const id = place?.episode
      ? episode?.kind === 'here'
        ? episode.bookId
        : null
      : place
        ? findPlaceBook(db, profileId, place)
        : null;
    return id ? getBook(db, profileId, id) : null;
  }, [place, episode, version]);
  const [busy, setBusy] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const failed = (error: unknown) =>
    showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));

  const play = () => {
    if (!place) return;
    if (place.episode) {
      setBusy(true);
      void playSharedEpisode(place)
        .then((played) => {
          if (played) openPlayer(router);
          else showAlert(t('Cannot play'), t('The podcast’s feed no longer lists this episode.'));
        })
        .catch(failed)
        .finally(() => {
          setBusy(false);
          refresh();
        });
      return;
    }
    if (!book) return;
    // A shared clip stops at its end (M88).
    const start =
      place.toMs === null
        ? playAt(book.book.id, place.atMs)
        : playClip(book.book.id, place.atMs, place.toMs);
    void start.then(() => openPlayer(router)).catch(failed);
  };

  const playButton = (label: string) => <Button text={label} onPress={play} busy={busy} />;

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
      <ScreenHeader onBack={back} />
      <LoadState
        loading={false}
        failed={!place && { title: t('This link does not name a place in a book.') }}
      >
        {place && (
          <>
            <View className="flex-row items-center gap-4">
              {book && <BookCover uri={coverUri(book.book)} title={book.book.title} size={96} />}
              <View className="flex-1 gap-1">
                <Text accessibilityRole="header" className="text-heading font-semibold text-paper">
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
            {place.episode ? (
              <View className="gap-2">
                {episode?.kind === 'here' ? (
                  playButton(t('Play from {time}', { time: formatClock(place.atMs) }))
                ) : episode?.kind === 'missing' && episode.subscribed ? (
                  <>
                    <Text className="text-soft">
                      {t('This episode is not in your copy of the podcast’s feed yet.')}
                    </Text>
                    {playButton(t('Refresh and play'))}
                    <TextButton
                      className="self-start"
                      text={t('Open the podcast')}
                      onPress={() =>
                        router.push({ pathname: '/podcast', params: { id: episode.podcastId } })
                      }
                    />
                  </>
                ) : episode ? (
                  <>
                    <Text className="text-soft">
                      {t(
                        'You are not subscribed to this podcast. Lelap can subscribe from its feed and play the episode; the audio comes from the podcast, not from the link.',
                      )}
                    </Text>
                    {playButton(t('Subscribe and play'))}
                  </>
                ) : (
                  <Text className="text-soft">{t('This episode is not on your shelf.')}</Text>
                )}
              </View>
            ) : book ? (
              <View className="gap-2">
                {book.book.title !== place.title && (
                  <Text className="text-detail text-muted">
                    {t('In your library as “{title}”.', { title: book.book.title })}
                  </Text>
                )}
                {playButton(t('Play from {time}', { time: formatClock(place.atMs) }))}
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
      </LoadState>
    </ScrollView>
  );
}
