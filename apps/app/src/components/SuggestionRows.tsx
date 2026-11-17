import { candidatesFrom, recommendationCatalogs, suggestionRows } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';

import { t } from '../i18n';
import { useAddons } from '../addons';
import { useAvailability } from '../availability';
import { db } from '../db';
import { useLibrary } from '../player';
import { profileId } from '../profile';
import { catalogQuery } from './CatalogRow';
import { MetaTile } from './MetaCard';
import { TextButton } from './TextButton';

const TILE = 120;

// Kept outside the component so the combined list stays the same object until a page changes.
const dataOf = (results: { data?: MetaPreview[] | undefined }[]) => results.map((r) => r.data);

/**
 * “Because you finished …” rows. They are worked out on the device from the catalog pages Home
 * loads anyway (the same queries, so the same requests), and their tiles ask nothing new: no
 * artwork and no source lookups that Home's own rows would not make.
 */
export function SuggestionRows({
  onOpen,
  onHide,
}: {
  onOpen: (meta: MetaPreview) => void;
  onHide: () => void;
}) {
  const { version } = useLibrary();
  const addons = useAddons();
  const refs = useMemo(() => recommendationCatalogs(addons), [addons]);
  const pages = useQueries({
    queries: refs.map((ref) => catalogQuery(ref)),
    combine: dataOf,
  });
  const availability = useAvailability();
  // `version` is the signal to re-read the database: a book finished, added or removed.
  const rows = useMemo(
    () => suggestionRows(db, profileId, candidatesFrom(refs, pages)),
    [refs, pages, version],
  );

  return rows.map((row) => (
    <View key={row.because.bookId} className="gap-2">
      <View className="min-h-12 flex-row items-center justify-between gap-2 ps-4 pe-2">
        <Text accessibilityRole="header" className="flex-1 text-lg font-semibold text-paper">
          {t('Because you finished {title}', { title: row.because.title })}
        </Text>
        <TextButton
          text={t('Hide')}
          tone="muted"
          accessibilityLabel={t('Hide suggestions')}
          onPress={onHide}
        />
      </View>
      <FlatList
        horizontal
        data={row.items}
        keyExtractor={(m) => `${m.type} ${m.id}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        extraData={availability}
        renderItem={({ item }) => (
          <MetaTile
            meta={item}
            width={TILE}
            availability={availability(item)}
            onPress={onOpen}
            askArtwork={false}
          />
        )}
      />
    </View>
  ));
}
