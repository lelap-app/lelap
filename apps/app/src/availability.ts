import {
  type Availability,
  browseCatalogs,
  checkWanted,
  fetchCatalog,
  getProfile,
  type InstalledAddon,
  listAddons,
  localLookup,
  listWanted,
  rememberWanted,
  SourceCache,
  streamAvailability,
  WANT_TO_READ,
  type WorkRef,
} from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { fetcher, SHOWN_TYPES } from './addons';
import { db } from './db';
import { t } from './i18n';
import { canNotify, notify } from './platform/downloads';
import { useLibrary } from './player';
import { profileId } from './profile';

/** The add-ons this profile sees, read fresh: the background task has no React state. */
export function profileAddons(): InstalledAddon[] {
  const hidden = new Set(getProfile(db, profileId)?.hiddenAddons ?? []);
  return listAddons(db).filter((a) => !hidden.has(a.url));
}

const workOf = (meta: Pick<MetaPreview, 'type' | 'id' | 'name' | 'author'>): WorkRef => ({
  type: meta.type,
  id: meta.id,
  name: meta.name,
  ...(meta.author ? { author: meta.author } : {}),
});

// Null until the tabs mount; until then the database says which add-ons to ask.
let askedAddons: InstalledAddon[] | null = null;
const ask = (work: WorkRef) =>
  streamAvailability(fetcher, askedAddons ?? profileAddons(), work.type, work.id);

// Podcasts play from their feeds, not from add-on streams, so they get no badge.
const badged = (meta: Pick<MetaPreview, 'type'>) => meta.type === 'audiobook';

/** Which add-ons stream which catalog items, filled for the items on screen. */
export const sourceCache = new SourceCache(ask);

let version = 0;
sourceCache.subscribe(() => version++);
const subscribe = (listener: () => void) => sourceCache.subscribe(listener);
const getVersion = () => version;

/** Starts over when the profile's add-ons change, since the answers came from the old ones. */
export function useSourceCacheAddons(addons: InstalledAddon[]): void {
  const key = addons.map((a) => a.url).join('\n');
  useEffect(() => {
    askedAddons = addons;
    sourceCache.reset(ask);
    // `key` stands for the list; the array itself is new on every library change.
  }, [key]);
}

/** Re-renders whenever the cache learns something; returns a lookup for the current answers. */
export function useAvailability(): (meta: MetaPreview) => Availability | undefined {
  const { version: library } = useLibrary();
  const cacheVersion = useSyncExternalStore(subscribe, getVersion, getVersion);
  // `library` is the signal to re-read the database.
  const isLocal = useMemo(() => localLookup(db, profileId), [library]);
  return useCallback(
    (meta: MetaPreview) => {
      if (!badged(meta)) return undefined;
      return isLocal(workOf(meta)) ? { kind: 'local' } : sourceCache.get(workOf(meta));
    },
    // `cacheVersion` makes a new lookup, so memoised tiles see new answers.
    [isLocal, cacheVersion],
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 30, minimumViewTime: 150 };

/**
 * Props for a FlatList or SectionList that asks for sources of the items that come into view. An
 * item may be one row of a grid, an array of items.
 */
export function useAskWhenVisible() {
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item?: unknown }[] }) => {
      const works = viewableItems.flatMap((token) => {
        const items = (Array.isArray(token.item) ? token.item : [token.item]) as (
          MetaPreview | undefined
        )[];
        return items.flatMap((item) =>
          item && typeof item.id === 'string' && badged(item) ? [workOf(item)] : [],
        );
      });
      sourceCache.request(works);
    },
  ).current;
  return { onViewableItemsChanged, viewabilityConfig: VIEWABILITY };
}

/** The want-to-read shelves of the profile's add-ons. */
const wantedShelves = (addons: InstalledAddon[]) =>
  browseCatalogs(addons, SHOWN_TYPES).filter((ref) => ref.catalog.shelf === WANT_TO_READ);

/**
 * Reads the want-to-read shelves, remembers their books, asks again for the ones without a
 * source, and posts “Now playable” for each that got one. For the background refresh.
 */
export async function refreshWanted(): Promise<void> {
  const addons = profileAddons();
  const shelves = wantedShelves(addons);
  // Books from an import (M102) are wanted without a shelf.
  const imported = listWanted(db, profileId).some((w) => w.from !== undefined);
  if (shelves.length === 0 && !imported) return;
  const now = Date.now();
  if (shelves.length > 0) {
    const read = await Promise.allSettled(shelves.map((ref) => fetchCatalog(fetcher, ref)));
    const works = read.flatMap((r) => (r.status === 'fulfilled' ? r.value.map(workOf) : []));
    rememberWanted(db, profileId, works, now, {
      prune: read.every((r) => r.status === 'fulfilled'),
    });
  }
  const isLocal = localLookup(db, profileId);
  const news = await checkWanted(
    db,
    profileId,
    (work) =>
      isLocal(work)
        ? Promise.resolve({ kind: 'local' })
        : streamAvailability(fetcher, addons, work.type, work.id),
    now,
  );
  // Without permission the books still count as checked: the badge shows it next time.
  if (!canNotify()) return;
  for (const work of news) {
    notify(
      `wanted:${work.type}:${work.id}`,
      t('Now playable: {title}', { title: work.name }),
      work.author ?? t('A book you want to read has a source.'),
      `lelap://item?type=${encodeURIComponent(work.type)}&id=${encodeURIComponent(work.id)}`,
    );
  }
}
