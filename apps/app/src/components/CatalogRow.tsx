import { type CatalogRef, fetchCatalog } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { COLORS, Icon } from './Icon';
import { fetcher } from '../addons';
import { useAskWhenVisible, useAvailability } from '../availability';
import { MetaTile } from './MetaCard';

const TILE = 120;

/** How many tiles a row draws from the start, scrolled or not; suggestions rely on it. */
export const HOME_FIRST_DRAWN = 10;

export const catalogQuery = (ref: CatalogRef, extra: Record<string, string> = {}) => ({
  queryKey: ['catalog', ref.addon.url, ref.catalog.type, ref.catalog.id, extra],
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
  const { data, isPending, isError } = useQuery(catalogQuery(catalogRef));
  const availability = useAvailability();
  const visible = useAskWhenVisible();
  if (isError || (data && data.length === 0)) return null;

  return (
    <View className="gap-2">
      <Pressable
        onPress={onMore}
        accessibilityRole="button"
        className="min-h-12 flex-row items-center justify-between px-4"
      >
        <Text className="text-lg font-semibold text-paper">{title ?? catalogRef.catalog.name}</Text>
        <View className="flex-row items-center">
          <Text className="text-sm text-amber">{t('More')}</Text>
          <Icon name="forward" size={16} color={COLORS.amber} />
        </View>
      </Pressable>
      {isPending ? (
        <View style={{ height: TILE + 40 }} className="justify-center">
          <ActivityIndicator color="#f5b041" />
        </View>
      ) : (
        <FlatList
          horizontal
          data={data}
          keyExtractor={(m) => m.id}
          initialNumToRender={HOME_FIRST_DRAWN}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          {...visible}
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
