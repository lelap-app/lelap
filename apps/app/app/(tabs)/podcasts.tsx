import { listSubscriptions } from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { TextField } from '../../src/components/TextField';
import { showAlert } from '../../src/dialog';
import { BookCover } from '../../src/components/BookCover';
import { newEpisodesBadges, useBadgesOn, withBadges } from '../../src/components/CoverBadges';
import { db } from '../../src/db';
import { openPage } from '../../src/navigation';
import { useLibrary } from '../../src/player';
import { exportOpml, importOpml, refreshPodcasts, subscribeToFeed } from '../../src/podcasts';
import { readPickedText, shareText } from '../../src/platform/files';
import { activeProfile, profileId } from '../../src/profile';
import { IconButton } from '../../src/components/Icon';
import { TextButton } from '../../src/components/TextButton';
import { LIST_COLUMN } from '../../src/layout';
import { useColors } from '../../src/theme';
import { TabHeader } from '../../src/components/TabHeader';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function PodcastsScreen() {
  const colors = useColors();
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
      openPage(router, { pathname: '/podcast', params: { id: podcastId } });
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
      contentContainerStyle={{ ...LIST_COLUMN, paddingTop: insets.top + 12, paddingBottom: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.amber}
        />
      }
      ListHeaderComponent={
        <View className="gap-4 pb-4">
          <TabHeader title={t('Podcasts')}>
            <IconButton
              name="queue"
              label={t('Up next')}
              color={colors.soft}
              onPress={() => router.push('/up-next')}
            />
          </TabHeader>
          <View className="gap-4 px-4">
            {/* Kids subscribe from the catalogs they are allowed; feed addresses and OPML stay with grown-ups. */}
            {!kids && (
              <>
                <View className="flex-row items-center gap-2">
                  <TextField
                    value={feedUrl}
                    onChangeText={setFeedUrl}
                    placeholder={t('Podcast feed address')}
                    accessibilityLabel={t('Podcast feed address')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    onSubmitEditing={() => void add()}
                    className="flex-1"
                  />
                  <Button
                    kind="secondary"
                    size="sm"
                    text={t('Add')}
                    disabled={feedUrl.trim() === ''}
                    busy={busy}
                    onPress={() => void add()}
                  />
                </View>
                <View className="flex-row gap-4">
                  <TextButton
                    text={t('Import subscriptions')}
                    disabled={busy}
                    onPress={() => void importFile()}
                  />
                  {subs.length > 0 && (
                    <TextButton
                      text={t('Export subscriptions')}
                      onPress={() => void shareText('lelap-subscriptions.opml', exportOpml())}
                    />
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          lori
          title={t('No podcasts yet.')}
          body={
            kids
              ? t('Find podcasts in Search and subscribe there.')
              : t(
                  'Find podcasts in Search, paste a feed address, or import an OPML file from another app. A podcast folder in your Library can become a subscription too: long-press it there.',
                )
          }
          action={{ label: t('Search for podcasts'), onPress: () => router.navigate('/search') }}
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
            onPress={() =>
              openPage(router, { pathname: '/podcast', params: { id: sub.podcastId } })
            }
            accessibilityRole="button"
            accessibilityLabel={withBadges([sub.title, status], badges)}
            className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
          >
            <BookCover uri={sub.coverUrl} title={sub.title} size={56} badges={badges} />
            <View className="flex-1 gap-1">
              <Text numberOfLines={2} className="text-body text-paper">
                {sub.title}
              </Text>
              <Text numberOfLines={1} className="text-detail text-muted">
                {status}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
