import {
  APP_PROTOCOL_VERSION,
  browseCatalogs,
  type CatalogRef,
  fetchCatalog,
  genreOptions,
} from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { fetcher, SHOWN_TYPES, useAddons } from '../../src/addons';
import { useAskWhenVisible, useAvailability } from '../../src/availability';
import { EmptyState } from '../../src/components/EmptyState';
import { Icon } from '../../src/components/Icon';
import { LoadState } from '../../src/components/LoadState';
import { MetaTile } from '../../src/components/MetaCard';
import { openItem } from '../../src/navigation';
import { Pill } from '../../src/components/Pill';
import { useWide } from '../../src/layout';
import { useColors } from '../../src/theme';
import { TabHeader } from '../../src/components/TabHeader';

const COLUMNS = 3;
// On a wide screen, as many columns as fit tiles about this wide.
const WIDE_TILE = 160;
const GAP = 12;

const keyOf = (ref: CatalogRef) => `${ref.addon.url} ${ref.catalog.type} ${ref.catalog.id}`;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pill
      onPress={onPress}
      accessibilityState={{ selected: active }}
      aria-selected={active}
      className={`rounded-full border px-3 py-1 ${active ? 'border-amber bg-amber' : 'border-line'}`}
    >
      <Text className={active ? 'text-ink' : 'text-soft'}>{label}</Text>
    </Pill>
  );
}

export default function DiscoverScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Beside the tab rail and the player, the screen is narrower than the window.
  const wide = useWide();
  const [space, setSpace] = useState<number | null>(null);
  const params = useLocalSearchParams<{ addon?: string; catalog?: string }>();
  const addons = useAddons();
  const catalogs = useMemo(() => browseCatalogs(addons, SHOWN_TYPES), [addons]);
  const [selected, setSelected] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [playableOnly, setPlayableOnly] = useState(false);
  const availability = useAvailability();
  const visible = useAskWhenVisible();

  // "More" on a Home row opens Discover on that catalog.
  useEffect(() => {
    const match = catalogs.find(
      (ref) => ref.addon.url === params.addon && ref.catalog.id === params.catalog,
    );
    if (match) {
      setSelected(keyOf(match));
      setGenre(null);
    }
  }, [params.addon, params.catalog, catalogs]);

  const current = catalogs.find((ref) => keyOf(ref) === selected) ?? catalogs[0];
  const genres = current ? genreOptions(current.catalog) : [];
  const columns = wide
    ? Math.max(COLUMNS, Math.floor(((space ?? width) - 32 + GAP) / (WIDE_TILE + GAP)))
    : COLUMNS;
  const tile = Math.floor(((wide ? (space ?? width) : width) - 32 - GAP * (columns - 1)) / columns);

  const query = useInfiniteQuery({
    queryKey: ['discover', APP_PROTOCOL_VERSION, current ? keyOf(current) : null, genre],
    enabled: current !== undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      if (!current) return Promise.resolve<MetaPreview[]>([]);
      const extra: Record<string, string> = {};
      if (genre) extra.genre = genre;
      if (pageParam > 0) extra.skip = String(pageParam);
      return fetchCatalog(fetcher, current, extra);
    },
    getNextPageParam: (last, pages) =>
      last.length === 0 ? undefined : pages.reduce((sum, page) => sum + page.length, 0),
  });

  // An add-on may repeat an item across pages; keys must be unique.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages.flat() ?? []).filter((m) => !seen.has(m.id) && seen.add(m.id));
  }, [query.data]);
  // Items still being asked about stay; only a known "Metadata only" is hidden.
  const shown = useMemo(
    () => (playableOnly ? items.filter((m) => availability(m)?.kind !== 'none') : items),
    [items, playableOnly, availability],
  );
  const hiddenCount = items.length - shown.length;
  // Rows made here rather than with numColumns, which can't change without a new list: that list
  // would start at the top each time the player pane opens or the window resizes.
  const rows = useMemo(() => {
    const out: MetaPreview[][] = [];
    for (let i = 0; i < shown.length; i += columns) out.push(shown.slice(i, i + columns));
    return out;
  }, [shown, columns]);

  return (
    <View
      className="flex-1 bg-night"
      style={{ paddingTop: insets.top + 12 }}
      onLayout={(e) => setSpace(e.nativeEvent.layout.width)}
    >
      <View className="pb-3">
        <TabHeader title={t('Discover')} />
      </View>
      {wide && space === null ? null : catalogs.length === 0 ? (
        <EmptyState title={t('No catalogs to browse. Add-ons in Settings bring them.')} />
      ) : (
        <FlatList
          data={rows}
          extraData={availability}
          {...visible}
          keyExtractor={(row) => row[0]?.id ?? ''}
          contentContainerStyle={{ gap: 16, paddingBottom: 24 }}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          ListHeaderComponent={
            <View className="gap-3">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
              >
                {catalogs.map((ref) => (
                  <Chip
                    key={keyOf(ref)}
                    label={
                      catalogs.filter((r) => r.catalog.name === ref.catalog.name).length > 1
                        ? `${ref.catalog.name} · ${ref.addon.manifest.name}`
                        : ref.catalog.name
                    }
                    active={current !== undefined && keyOf(ref) === keyOf(current)}
                    onPress={() => {
                      setSelected(keyOf(ref));
                      setGenre(null);
                    }}
                  />
                ))}
              </ScrollView>
              <View className="flex-row items-center gap-2 px-4">
                <Pill
                  onPress={() => setPlayableOnly((on) => !on)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: playableOnly }}
                  aria-checked={playableOnly}
                  className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${playableOnly ? 'border-amber' : 'border-line'}`}
                >
                  <Icon
                    name={playableOnly ? 'check' : 'play'}
                    size={14}
                    color={playableOnly ? colors.amber : colors.muted}
                  />
                  <Text className={playableOnly ? 'text-amber' : 'text-soft'}>
                    {t('Playable only')}
                  </Text>
                </Pill>
                {playableOnly && hiddenCount > 0 && (
                  <Text className="text-caption text-muted">
                    {hiddenCount === 1
                      ? t('1 without audio hidden')
                      : t('{n} without audio hidden', { n: hiddenCount })}
                  </Text>
                )}
              </View>
              {genres.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
                >
                  <Chip label={t('All')} active={genre === null} onPress={() => setGenre(null)} />
                  {genres.map((g) => (
                    <Chip
                      key={g}
                      label={g.charAt(0).toUpperCase() + g.slice(1)}
                      active={genre === g}
                      onPress={() => setGenre(g)}
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          }
          ListEmptyComponent={
            <LoadState
              loading={query.isPending}
              failed={
                query.isError && {
                  title: t('{name} did not answer', {
                    name: current?.addon.manifest.name ?? t('The add-on'),
                  }),
                }
              }
              onRetry={() => void query.refetch()}
            >
              <EmptyState title={t('Nothing here.')} />
            </LoadState>
          }
          ListFooterComponent={
            query.isFetchingNextPage ? <ActivityIndicator color={colors.amber} /> : undefined
          }
          renderItem={({ item: row }) => (
            <View style={{ flexDirection: 'row', gap: GAP, paddingHorizontal: 16 }}>
              {row.map((item) => (
                <MetaTile
                  key={item.id}
                  meta={item}
                  width={tile}
                  availability={availability(item)}
                  onPress={(meta) => openItem(router, meta)}
                />
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}
