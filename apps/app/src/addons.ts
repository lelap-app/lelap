import {
  type AddonBlock,
  addonBase,
  addonBlock,
  addonRefusals,
  AddonUpgradeError,
  APP_PROTOCOL_VERSION,
  addStreamedBook,
  AnswerCache,
  cachingFetcher,
  deviceValue,
  parseRefusals,
  setDeviceValue,
  checkHealth,
  chosenEdition,
  type AddonHealth,
  copyFallbackStep,
  type CopyFallback,
  copyKey,
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
  type InstalledAddon,
  listAddons,
  mergeSources,
  nextCopy,
  orderStreams,
  pickSource,
  streamPreferences,
  getSettings,
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

import { addonHealth } from './addonHealth';
import { defaultAddons } from './config';
import { t } from './i18n';
import { db, newId } from './db';
import { profileId } from './profile';
import { playBook, useLibrary } from './player';
import * as audio from './platform/audio';
import { callLocalAddon } from './sandbox';
import { callWithSettings } from './scrobblers';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 1 },
  },
});

export { addonHealth };

// Add-ons that run inside the app answer through their sandbox; all others over the network. One
// set up with settings (revision 9) gets them on every call.
const route: Fetcher = async (url, init) => {
  const local = splitLocalUrl(url);
  if (!local) return fetch(url, init);
  const { status, body } =
    (await callWithSettings(local.manifestUrl, local.path)) ??
    (await callLocalAddon(local.manifestUrl, local.path));
  const said = (body as { error?: unknown } | null)?.error;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    // An add-on inside the app says why in its error, such as a `426`'s note.
    text: async () => (typeof body === 'string' ? body : typeof said === 'string' ? said : ''),
  };
};

// Add-ons that answered `426 Upgrade Required` (M156) stay refused across starts, until the app's
// protocol revision changes.
const REFUSALS_KEY = 'addonRefusals';
addonRefusals.attach({
  read: () => parseRefusals(deviceValue(db, REFUSALS_KEY)),
  write: (all) => setDeviceValue(db, REFUSALS_KEY, JSON.stringify(all), Date.now()),
});

/** What to say for a failed add-on request; the add-on's own words for a `426` (M156). */
export function addonErrorText(error: unknown): string | null {
  if (error instanceof AddonUpgradeError) {
    const line = t('Update Lelap to use {name}', { name: error.addonName });
    return error.block.kind === 'refused' && error.block.note
      ? `${line}. ${error.block.note}`
      : line;
  }
  return error instanceof Error ? error.message : null;
}

/** Why the app asks this add-on nothing (M156), re-rendered when an add-on refuses it. */
export function useAddonBlock(addon: InstalledAddon): AddonBlock | null {
  useSyncExternalStore(addonRefusals.subscribe, addonRefusals.getVersion, addonRefusals.getVersion);
  return addonBlock(addon);
}

/** Answers kept for their `cacheMaxAge` (M159), in memory for this run. */
export const addonAnswers = new AnswerCache();

// The cache wraps the tracking: an answer from memory says nothing about the add-on's health.
export const fetcher: Fetcher = cachingFetcher(trackedFetcher(route, addonHealth), addonAnswers);

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

/**
 * Adds an add-on item to the library with the chosen stream and starts playing it. With the
 * other [copies] of its row on the item page, a copy the player can't open makes way for the
 * next ready one (M155), in the same book.
 */
export async function playItem(
  meta: Meta,
  found: FoundStream,
  copies: FoundStream[] = [],
): Promise<string> {
  disarmFallback();
  const bookId = addItem(meta, found);
  // Armed before the load, so it hears the player's first report on this copy.
  if (copies.length > 1) armFallback(bookId, meta, copies, found);
  try {
    await playBook(bookId);
  } catch (error) {
    disarmFallback();
    throw error;
  }
  return bookId;
}

type Fallback = {
  state: CopyFallback;
  meta: Meta;
  copies: FoundStream[];
  subscription: { remove(): void };
};
let fallback: Fallback | null = null;

function disarmFallback(): void {
  fallback?.subscription.remove();
  fallback = null;
}

function armFallback(bookId: string, meta: Meta, copies: FoundStream[], playing: FoundStream) {
  const armed: Fallback = {
    state: { bookId, tried: [copyKey(playing)], seen: false },
    meta,
    copies,
    subscription: audio.addStateListener((state) => void onFallbackState(armed, state)),
  };
  fallback = armed;
}

async function onFallbackState(armed: Fallback, state: audio.PlayerState): Promise<void> {
  if (fallback !== armed) return;
  const { step, fallback: next } = copyFallbackStep(armed.state, state);
  armed.state = next;
  if (step === 'done') return disarmFallback();
  if (step !== 'next') return;
  const copy = nextCopy(armed.copies, armed.state.tried);
  // No copy left: the last one's error stays under the player.
  if (!copy) return disarmFallback();
  try {
    const bookId = addItem(armed.meta, copy);
    // Set before the load: what the player reports from now on is about this copy.
    armed.state = { bookId, tried: [...armed.state.tried, copyKey(copy)], seen: false };
    await playBook(bookId);
  } catch {
    disarmFallback();
  }
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
  // The listener's order (M153), as the item page shows it.
  const ordered = orderStreams(
    sources.found,
    streamPreferences(getSettings(db, profileId)),
  ).flatMap((row) => row.copies);
  const stream = ordered[pickSource(ordered, [choice])];
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
    queryKey: ['meta', APP_PROTOCOL_VERSION, type, id, addons.map((a) => a.url)],
    queryFn: () => fetchMeta(fetcher, addons, type, id),
  }),
  streams: (addons: InstalledAddon[], type: ContentType, id: string) => ({
    queryKey: ['streams', APP_PROTOCOL_VERSION, type, id, addons.map((a) => a.url)],
    queryFn: () => fetchStreams(fetcher, addons, type, id),
  }),
  /** Streams from every add-on, asked by the work's ID or one of its external IDs. */
  sources: (
    addons: InstalledAddon[],
    type: ContentType,
    id: string,
    externalIds: Meta['externalIds'],
  ) => ({
    queryKey: [
      'sources',
      APP_PROTOCOL_VERSION,
      type,
      id,
      externalIds ?? {},
      addons.map((a) => a.url),
    ],
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
    queryKey: ['artwork', APP_PROTOCOL_VERSION, item.type, item.id],
    enabled: ask && !item.cover && offered,
    staleTime: DAY_MS,
    gcTime: DAY_MS,
    queryFn: () => fetchArtwork(fetcher, addons, item.type, item.id),
  });
  return item.cover ?? found.data ?? null;
}
