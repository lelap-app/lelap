import { APP_PROTOCOL_VERSION, type CatalogRef, fetchCatalog } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { Icon } from './Icon';
import { fetcher, useAddonBlock } from '../addons';
import { UpgradeNotice } from './UpgradeNotice';
import { useAskWhenVisible, useAvailability } from '../availability';
import { MetaTile } from './MetaCard';
import { sessionCovers } from '../sessionCovers';
import { useColors } from '../theme';

const TILE = 120;

/** How many tiles a row draws from the start, scrolled or not; suggestions rely on it. */
export const HOME_FIRST_DRAWN = 10;

export const catalogQuery = (ref: CatalogRef, extra: Record<string, string> = {}) => ({
  queryKey: [
    'catalog',
    APP_PROTOCOL_VERSION,
    ref.addon.url,
    ref.catalog.type,
    ref.catalog.id,
    extra,
  ],
  queryFn: () => fetchCatalog(fetcher, ref, extra),
});

/** One Home row: a catalog's first page as a horizontal list of covers. */
export function CatalogRow({
  catalogRef,
  title,
  onOpen,
  onMore,
}: {
  catalogRef: CatalogRef;
  /** In place of the catalog's own name. */
  title?: string;
  onOpen: (meta: MetaPreview) => void;
  onMore: () => void;
}) {
  const colors = useColors();
  const block = useAddonBlock(catalogRef.addon);
  const { data, isPending, isError } = useQuery({
    ...catalogQuery(catalogRef),
    enabled: block === null,
  });
  const availability = useAvailability();
  const { onViewableItemsChanged: askVisible, viewabilityConfig } = useAskWhenVisible();
  // Tiles on screen also note their covers, which suggestion tiles may then show (M118).
  const onViewableItemsChanged = useRef((info: { viewableItems: { item?: unknown }[] }) => {
    askVisible(info);
    sessionCovers.add(info.viewableItems.map((token) => (token.item ?? {}) as MetaPreview));
  }).current;
  // An add-on that won't work with this app keeps its row, to say so (M156).
  if (block)
    return (
      <View className="gap-1 px-4">
        <Text className="text-section font-semibold text-paper">
          {title ?? catalogRef.catalog.name}
        </Text>
        <UpgradeNotice name={catalogRef.addon.manifest.name} block={block} />
      </View>
    );
  if (isError || (data && data.length === 0)) return null;

  return (
    <View className="gap-2">
      <Pressable
        onPress={onMore}
        accessibilityRole="button"
        className="min-h-12 flex-row items-center justify-between px-4"
      >
        <Text className="text-section font-semibold text-paper">
          {title ?? catalogRef.catalog.name}
        </Text>
        <View className="flex-row items-center">
          <Text className="text-detail text-amber">{t('More')}</Text>
          <Icon name="forward" size={16} color={colors.amber} />
        </View>
      </Pressable>
      {isPending ? (
        <View style={{ height: TILE + 40 }} className="justify-center">
          <ActivityIndicator color={colors.amber} />
        </View>
      ) : (
        <FlatList
          horizontal
          data={data}
          keyExtractor={(m) => m.id}
          initialNumToRender={HOME_FIRST_DRAWN}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          // A new lookup means the cache learned something; re-render the tiles.
          extraData={availability}
          renderItem={({ item }) => (
            <MetaTile meta={item} width={TILE} availability={availability(item)} onPress={onOpen} />
          )}
        />
      )}
    </View>
  );
}
