import { type ContentType, ItemId, type Meta, supports } from '@lelap/sdk';
import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { books, settings } from '../schema';
import { type Fetcher, fetchAddonStreams, type FoundStream, type InstalledAddon } from './client';

/** One `stream` request: the add-on and the ID it is asked for. */
export type SourceRequest = { addon: InstalledAddon; id: string };

/**
 * The IDs a work is known by: its own first, then its `externalIds` as `prefix:value`
 * (`{ ol: 'OL1W' }` becomes `ol:OL1W`). Invalid or repeated IDs are left out.
 */
export function workIds(id: string, externalIds?: Meta['externalIds']): string[] {
  const ids = [id];
  for (const [prefix, value] of Object.entries(externalIds ?? {})) {
    const candidate = `${prefix}:${value}`;
    if (ItemId.safeParse(candidate).success && !ids.includes(candidate)) ids.push(candidate);
  }
  return ids;
}

/**
 * Which add-ons to ask for streams, and with which ID. Each add-on with a `stream` resource is
 * asked once, for the first of the work's IDs it takes, so an add-on that knows the work's own
 * ID is never also asked for a look-alike external one.
 */
export function sourceRequests(
  addons: InstalledAddon[],
  type: ContentType,
  ids: string[],
): SourceRequest[] {
  return addons.flatMap((addon) => {
    const id = ids.find((candidate) => supports(addon.manifest, 'stream', type, candidate));
    return id === undefined ? [] : [{ addon, id }];
  });
}

export type Sources = {
  /** Every stream found, in add-on order, without repeats. */
  found: FoundStream[];
  /** Names of the add-ons that were asked. */
  asked: string[];
  /** Names of the add-ons that did not answer. */
  failed: string[];
};

/**
 * Asks every installed add-on with a `stream` resource for this work, by its own ID or one of
 * its external IDs. A failing add-on is reported, not thrown, unless no add-on answered at all.
 */
export async function findSources(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
  externalIds?: Meta['externalIds'],
): Promise<Sources> {
  const requests = sourceRequests(addons, type, workIds(id, externalIds));
  const settled = await Promise.allSettled(
    requests.map((r) => fetchAddonStreams(fetcher, r.addon, type, r.id)),
  );
  const seen = new Set<string>();
  const found: FoundStream[] = [];
  const failed: string[] = [];
  for (const [index, result] of settled.entries()) {
    const request = requests[index];
    if (!request) continue;
    if (result.status === 'rejected') {
      failed.push(request.addon.manifest.name);
      continue;
    }
    for (const stream of result.value) {
      const key = sourceId(stream);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(stream);
    }
  }
  if (requests.length > 0 && failed.length === requests.length) {
    const first = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw first?.reason;
  }
  return { found, asked: requests.map((r) => r.addon.manifest.name), failed };
}

/** What sets a source apart from the others: the add-on and the stream's key. */
export type SourceChoice = { addonUrl: string; sourceKey: string };

const sourceId = (found: FoundStream) => `${found.addon.url}\n${found.stream.sourceKey}`;

/** How a source is listed: the stream's name and title, such as `LibriVox · read by Kara`. */
export function sourceLabel(found: FoundStream): string {
  return [found.stream.name, found.stream.title].filter(Boolean).join(' · ');
}

const matches = (found: FoundStream, choice: SourceChoice) =>
  found.addon.url === choice.addonUrl && found.stream.sourceKey === choice.sourceKey;

/** The index of the first choice that is still on offer, else 0. */
export function pickSource(found: FoundStream[], choices: (SourceChoice | null)[]): number {
  for (const choice of choices) {
    if (!choice) continue;
    const index = found.findIndex((f) => matches(f, choice));
    if (index >= 0) return index;
  }
  return 0;
}

// Kept in the settings table under keys `getSettings` ignores and sync never sends, so the
// choice needs no migration. One row per book the user picked a source for.
const choiceKey = (type: string, id: string) => `source:${type}:${id}`;

/** The source this profile picked for a work, if any. */
export function getSourceChoice(
  db: Db,
  profileId: string,
  type: string,
  id: string,
): SourceChoice | null {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.profileId, profileId), eq(settings.key, choiceKey(type, id))))
    .get();
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row.value);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as SourceChoice).addonUrl === 'string' &&
      typeof (value as SourceChoice).sourceKey === 'string'
    )
      return {
        addonUrl: (value as SourceChoice).addonUrl,
        sourceKey: (value as SourceChoice).sourceKey,
      };
  } catch {
    // An unreadable row counts as no choice.
  }
  return null;
}

/** Remembers the source this profile picked for a work. */
export function setSourceChoice(
  db: Db,
  profileId: string,
  type: string,
  id: string,
  choice: SourceChoice,
  now: number,
): void {
  const value = JSON.stringify({ addonUrl: choice.addonUrl, sourceKey: choice.sourceKey });
  db.insert(settings)
    .values({ profileId, key: choiceKey(type, id), value, updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: now },
    })
    .run();
}

/** The source a library book plays, as a choice. */
export function bookSourceChoice(db: Db, bookId: string): SourceChoice | null {
  const ref = db
    .select({ addonItem: books.addonItem })
    .from(books)
    .where(eq(books.id, bookId))
    .get()?.addonItem;
  return ref ? { addonUrl: ref.addonUrl, sourceKey: ref.sourceKey } : null;
}
