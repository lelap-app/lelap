import {
  addStreamedBook,
  type Fetcher,
  fetchMeta,
  fetchStreams,
  findSources,
  getProfile,
  type FoundStream,
  type InstalledAddon,
  listAddons,
  syncAddons,
} from '@lelap/core';
import type { ContentType, Meta } from '@lelap/sdk';
import { QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { defaultAddons } from './config';
import { db, newId } from './db';
import { profileId } from './profile';
import { playBook, useLibrary } from './player';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, retry: 1 },
  },
});

export const fetcher: Fetcher = (url, init) => fetch(url, init);

/** The content types the app shows. */
export const SHOWN_TYPES: ContentType[] = ['audiobook', 'podcast'];

/** Installed add-ons, re-read whenever the library version changes. */
/** Installed add-ons this profile sees, re-read whenever the library version changes. */
export function useAddons(): InstalledAddon[] {
  const { version } = useLibrary();
  // `version` is the signal to re-read the database.
  return useMemo(() => {
    const hidden = new Set(getProfile(db, profileId)?.hiddenAddons ?? []);
    return listAddons(db).filter((a) => !hidden.has(a.url));
  }, [version]);
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
