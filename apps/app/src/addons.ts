import {
  addonBase,
  addStreamedBook,
  checkHealth,
  chosenEdition,
  type AddonHealth,
  type Fetcher,
  fetchArtwork,
  fetchManifest,
  fetchMeta,
  fetchStreams,
  findSources,
  findStreamedBook,
  findYourCopy,
  getEditionChoice,
  getProfile,
  getSourceChoice,
  type FoundStream,
  HealthTracker,
  type InstalledAddon,
  listAddons,
  mergeSources,
  pickSource,
  refreshSources,
  type Sources,
  splitLocalUrl,
  syncAddons,
  trackedFetcher,
  withEdition,
} from '@lelap/core';
import { CONTENT_TYPES, type ContentType, type Meta, offersHealth, supports } from '@lelap/sdk';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { defaultAddons } from './config';
import { t } from './i18n';
import { db, newId } from './db';
import { logAddonFailure } from './diagnostics';
import { profileId } from './profile';
import { playBook, useLibrary } from './player';
import { callLocalAddon } from './sandbox';
import { callWithSettings } from './scrobblers';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 1 },
  },
});

/** What each add-on's requests did during this run, for Settings → Library and sources → Add-ons. Kept in memory only. */
export const addonHealth = new HealthTracker(logAddonFailure);

// Add-ons that run inside the app answer through their sandbox; all others over the network. One
// set up with settings (revision 9) gets them on every call.
const route: Fetcher = async (url, init) => {
  const local = splitLocalUrl(url);
  if (!local) return fetch(url, init);
  const { status, body } =
    (await callWithSettings(local.manifestUrl, local.path)) ??
    (await callLocalAddon(local.manifestUrl, local.path));
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

export const fetcher: Fetcher = trackedFetcher(route, addonHealth);

/** One add-on's health, re-rendered when any request finishes. */
export function useAddonHealth(url: string): AddonHealth {
  useSyncExternalStore(addonHealth.subscribe, addonHealth.getVersion, addonHealth.getVersion);
  return addonHealth.get(url);
}

/** Asks each add-on's `/health`, or its manifest when it has none; never throws. */
export async function checkAddonHealth(addons: InstalledAddon[]): Promise<void> {
  await Promise.all(
    addons.map((a) =>
      offersHealth(a.manifest)
        ? checkHealth(fetcher, a, addonHealth)
        : fetchManifest(fetcher, a.url).catch(() => null),
    ),
  );
}

/**
 * Where an add-on's configure page sends the listener back: the app's own link on Android, this
 * page's `/addon` route on the web (the add-on must list the web app's origin to allow it).
 */
function returnTarget(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined')
    return `${window.location.origin}/addon`;
  return 'lelap://addon';
}

/** The add-on's configure page, for a manifest URL with or without settings in it. */
export function configurePageUrl(manifestUrl: string): string {
  return `${addonBase(manifestUrl)}configure?return=${encodeURIComponent(returnTarget())}`;
}

/** The content types the app shows. */
export const SHOWN_TYPES: ContentType[] = ['audiobook', 'podcast'];

/** Installed add-ons this profile sees, read now. */
function visibleAddons(): InstalledAddon[] {
  const hidden = new Set(getProfile(db, profileId)?.hiddenAddons ?? []);
  return listAddons(db).filter((a) => !hidden.has(a.url));
}

/** Installed add-ons this profile sees, re-read whenever the library version changes. */
export function useAddons(): InstalledAddon[] {
  const { version } = useLibrary();
  // `version` is the signal to re-read the database.
  return useMemo(() => visibleAddons(), [version]);
}

/** Every installed add-on, for grown-ups choosing what a profile sees. */
export function useAllAddons(): InstalledAddon[] {
  const { version } = useLibrary();
  // `version` is the signal to re-read the database.
  return useMemo(() => listAddons(db), [version]);
}

/** Installs the default add-ons and refreshes manifests. Never throws; offline is normal. */
export async function syncAddonsNow(): Promise<void> {
  await syncAddons(db, fetcher, defaultAddons, Date.now(), newId).catch(() => {});
}

/** Adds an add-on item to the library with the chosen stream, or refreshes it. */
export function addItem(meta: Meta, found: FoundStream): string {
  return addStreamedBook(db, {
    addonUrl: found.addon.url,
    meta,
    stream: found.stream,
    now: Date.now(),
    newId,
  });
}

/** Adds an add-on item to the library with the chosen stream and starts playing it. */
export async function playItem(meta: Meta, found: FoundStream): Promise<string> {
  const bookId = addItem(meta, found);
  await playBook(bookId);
  return bookId;
}

const isType = (value: string): value is ContentType =>
  (CONTENT_TYPES as readonly string[]).includes(value);

/**
 * The library's book for a catalog item, added first as Play adds it but without playing (M120):
 * the listener's own copy of the work, else the source and edition chosen on its page, else the
 * first source found. Throws when no add-on has audio for it.
 */
export async function addWork(type: string, id: string): Promise<string> {
  const known = findStreamedBook(db, type, id);
  if (known) return known;
  if (!isType(type)) throw new Error(t('This item was not found.'));
  const addons = visibleAddons();
  const found = await queryClient.fetchQuery(queries.meta(addons, type, id));
  if (!found) throw new Error(t('This item was not found.'));
  const work = withEdition(
    found.meta,
    chosenEdition(found.meta, getEditionChoice(db, profileId, type, id)),
  );
  const position = Number.parseFloat(work.series?.[0]?.position ?? '');
  const yours = findYourCopy(db, {
    type,
    id,
    title: work.name,
    author: work.author ?? null,
    externalIds: work.externalIds,
    series: Number.isInteger(position) ? position : null,
  });
  if (yours && yours.how !== 'offer') return yours.bookId;
  const sources = await queryClient.fetchQuery(queries.sources(addons, type, id, work.externalIds));
  const choice = getSourceChoice(db, profileId, type, id);
  const stream = sources.found[pickSource(sources.found, [choice])];
  if (!stream) throw new Error(t('No audio for this book yet'));
  return addItem(work, stream);
}

/**
 * The second look a slow add-on asked for with `refreshAfter` (M152): asks it again past every
 * cache and adds new streams below the ones the item page shows. Its answer replaces the cached
 * one; nothing is asked a third time.
 */
export async function refreshItemSources(
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
  externalIds: Meta['externalIds'],
): Promise<void> {
  const { queryKey } = queries.sources(addons, type, id, externalIds);
  const current = queryClient.getQueryData<Sources>(queryKey);
  if (!current || current.refresh.length === 0) return;
  const next = await refreshSources(fetcher, type, current);
  queryClient.setQueryData<Sources>(queryKey, (now) =>
    now === current ? next : now ? mergeSources(now, next.found) : next,
  );
}

export const queries = {
  meta: (addons: InstalledAddon[], type: ContentType, id: string) => ({
    queryKey: ['meta', type, id, addons.map((a) => a.url)],
    queryFn: () => fetchMeta(fetcher, addons, type, id),
  }),
  streams: (addons: InstalledAddon[], type: ContentType, id: string) => ({
    queryKey: ['streams', type, id, addons.map((a) => a.url)],
    queryFn: () => fetchStreams(fetcher, addons, type, id),
  }),
  /** Streams from every add-on, asked by the work's ID or one of its external IDs. */
  sources: (
    addons: InstalledAddon[],
    type: ContentType,
    id: string,
    externalIds: Meta['externalIds'],
  ) => ({
    queryKey: ['sources', type, id, externalIds ?? {}, addons.map((a) => a.url)],
    queryFn: () => findSources(fetcher, addons, type, id, externalIds),
  }),
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The item's own cover, else one from an add-on with an `artwork` resource for it (cached a day).
 * Null while asking or when no add-on has one; the cover then shows the title's letter. With
 * `ask: false` it only reads what an earlier request found.
 */
export function useArtwork(
  item: {
    id: string;
    type: ContentType;
    cover?: string | undefined;
  },
  { ask = true }: { ask?: boolean } = {},
): string | null {
  const addons = useAddons();
  const offered = useMemo(
    () => addons.some((a) => supports(a.manifest, 'artwork', item.type, item.id)),
    [addons, item.type, item.id],
  );
  const found = useQuery({
    queryKey: ['artwork', item.type, item.id],
    enabled: ask && !item.cover && offered,
    staleTime: DAY_MS,
    gcTime: DAY_MS,
    queryFn: () => fetchArtwork(fetcher, addons, item.type, item.id),
  });
  return item.cover ?? found.data ?? null;
}
