import { listSubscriptions } from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { EmptyState } from '../../src/components/Lori';
import { showAlert } from '../../src/dialog';
import { BookCover } from '../../src/components/BookCover';
import { newEpisodesBadges, useBadgesOn, withBadges } from '../../src/components/CoverBadges';
import { db } from '../../src/db';
import { useLibrary } from '../../src/player';
import { exportOpml, importOpml, refreshPodcasts, subscribeToFeed } from '../../src/podcasts';
import { readPickedText, shareText } from '../../src/platform/files';
import { activeProfile, profileId } from '../../src/profile';
import { TextButton } from '../../src/components/TextButton';
import { COLORS } from '../../src/components/Icon';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function PodcastsScreen() {
  const kids = activeProfile()?.kids ?? false;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const [feedUrl, setFeedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // `version` is the signal to re-read the database.
  const subs = useMemo(() => listSubscriptions(db, profileId), [version]);
  const badgesOn = useBadgesOn();

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showAlert(t('Podcasts'), message(error));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const add = () =>
    run(async () => {
      const podcastId = await subscribeToFeed(feedUrl);
      setFeedUrl('');
      router.push({ pathname: '/podcast', params: { id: podcastId } });
    });

  const importFile = () =>
    run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;
      const result = await importOpml(await readPickedText(asset));
      showAlert(
        t('{n} podcasts added', { n: result.added }),
        result.failed.length > 0
          ? t('Could not read: {names}', { names: result.failed.join(', ') })
          : undefined,
      );
    });

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshPodcasts(true).catch(() => {});
    setRefreshing(false);
    refresh();
  };

  return (
    <FlatList
      className="flex-1 bg-night"
      data={subs}
      keyExtractor={(s) => s.podcastId}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={COLORS.amber}
        />
      }
      ListHeaderComponent={
        <View className="gap-4 px-4 pb-4">
          <View className="flex-row items-center justify-between">
            <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
              {t('Podcasts')}
            </Text>
            <TextButton text={t('Up Next')} onPress={() => router.push('/up-next')} />
          </View>
          {/* Kids subscribe from the catalogs they are allowed; feed addresses and OPML stay with grown-ups. */}
          {!kids && (
            <>
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={feedUrl}
                  onChangeText={setFeedUrl}
                  placeholder={t('Feed address (RSS)')}
                  accessibilityLabel={t('Feed address (RSS)')}
                  placeholderTextColor={COLORS.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onSubmitEditing={() => void add()}
                  className="min-h-12 min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-paper"
                />
                <Pressable
                  disabled={busy || feedUrl.trim() === ''}
                  onPress={() => void add()}
                  accessibilityRole="button"
                  accessibilityLabel={t('Add')}
                  className="min-h-12 min-w-12 items-center justify-center px-1"
                >
                  {busy ? (
                    <ActivityIndicator color={COLORS.amber} />
                  ) : (
                    <Text className={feedUrl.trim() === '' ? 'text-muted' : 'text-amber'}>
                      {t('Add')}
                    </Text>
                  )}
                </Pressable>
              </View>
              <View className="flex-row gap-4">
                <TextButton
                  text={t('Import OPML')}
                  disabled={busy}
                  onPress={() => void importFile()}
                />
                {subs.length > 0 && (
                  <TextButton
                    text={t('Export OPML')}
                    onPress={() => void shareText('lelap-subscriptions.opml', exportOpml())}
                  />
                )}
              </View>
            </>
          )}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title={t('No podcasts yet.')}
          hint={
            kids
              ? t('Find podcasts in Search and subscribe there.')
              : t(
                  'Find podcasts in Search, paste a feed address, or import an OPML file from another app. A podcast folder in your Library can become a subscription too: long-press it there.',
                )
          }
          actions={[{ label: t('Search for podcasts'), onPress: () => router.navigate('/search') }]}
        />
      }
      renderItem={({ item: sub }) => {
        const badges = newEpisodesBadges(sub.newEpisodes, badgesOn);
        const status = [
          sub.author,
          sub.unplayed > 0 ? t('{n} unplayed', { n: sub.unplayed }) : t('All played'),
          sub.autoDownload ? t('Auto-download') : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/podcast', params: { id: sub.podcastId } })}
            accessibilityRole="button"
            accessibilityLabel={withBadges([sub.title, status], badges)}
            className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
          >
            <BookCover uri={sub.coverUrl} title={sub.title} size={56} badges={badges} />
            <View className="flex-1 gap-1">
              <Text numberOfLines={2} className="text-base text-paper">
                {sub.title}
              </Text>
              <Text numberOfLines={1} className="text-sm text-muted">
                {status}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
