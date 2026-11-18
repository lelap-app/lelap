import type { Edition, Meta } from '@lelap/sdk';
import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { settings } from '../schema';

// Editions on the item page (M66, protocol revision 9). The listener's choice of edition is kept on
// this device per profile, in the settings table under keys `getSettings` ignores, like the source
// choice; it changes what the page shows and which IDs add-ons are asked for audio by.

const editionKey = (type: string, id: string) => `edition:${type}:${id}`;

/** The edition this profile chose for a work, as its `key`, if any. */
export function getEditionChoice(
  db: Db,
  profileId: string,
  type: string,
  id: string,
): string | null {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.profileId, profileId), eq(settings.key, editionKey(type, id))))
    .get();
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row.value);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the edition this profile chose for a work; null forgets it. */
export function setEditionChoice(
  db: Db,
  profileId: string,
  type: string,
  id: string,
  key: string | null,
  now: number,
): void {
  const where = and(eq(settings.profileId, profileId), eq(settings.key, editionKey(type, id)));
  if (key === null) {
    db.delete(settings).where(where).run();
    return;
  }
  const value = JSON.stringify(key);
  db.insert(settings)
    .values({ profileId, key: editionKey(type, id), value, updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: now },
    })
    .run();
}

/** The chosen edition among the meta's, or null when there is none or it is gone. */
export function chosenEdition(meta: Meta | undefined, key: string | null): Edition | null {
  if (!meta?.editions || key === null) return null;
  return meta.editions.find((e) => e.key === key) ?? null;
}

/**
 * The meta as the item page shows it with an edition chosen: the edition's cover, year,
 * narrators, length and language where it has them, and its IDs over the work's, so add-ons that
 * know the edition by its ASIN or ISBN are asked by those.
 */
export function withEdition(meta: Meta, edition: Edition | null): Meta {
  if (!edition) return meta;
  const externalIds = { ...meta.externalIds, ...edition.externalIds };
  // The work's chapters fit a recording of the work's length; another length isn't that recording.
  const { chapters, ...rest } = meta;
  const otherLength = edition.durationMs !== undefined && edition.durationMs !== meta.durationMs;
  return {
    ...rest,
    ...(chapters && !otherLength ? { chapters } : {}),
    ...(edition.cover ? { cover: edition.cover } : {}),
    ...(edition.year ? { year: edition.year } : {}),
    ...(edition.narrators?.length ? { narrators: edition.narrators } : {}),
    ...(edition.durationMs ? { durationMs: edition.durationMs } : {}),
    ...(edition.language ? { language: edition.language } : {}),
    ...(Object.keys(externalIds).length > 0 ? { externalIds } : {}),
  };
}
