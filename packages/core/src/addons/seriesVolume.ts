import { type MetaPreview, sameAuthors, splitAuthors, titleKey } from '@lelap/sdk';

import { seriesKey, seriesNumber } from '../library/seriesNames';
import {
  type Fetcher,
  fetchCatalog,
  fetchMeta,
  type InstalledAddon,
  searchCatalogs,
} from './client';

/** A catalog work that is one number of a series, for its item page. */
export type SeriesVolume = Pick<MetaPreview, 'type' | 'id' | 'name' | 'author' | 'cover'>;

/** How many search results get their meta read before giving up. */
const METAS_READ = 8;

/**
 * Looks in the add-ons' search catalogs for one number of a series (M109), only when the listener
 * asks: the search sends the series' name and author, nothing else from the library. A result
 * counts when its meta names the same series at that number.
 */
export async function findSeriesVolume(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  want: { name: string; author: string | null; number: number },
): Promise<SeriesVolume | null> {
  const refs = searchCatalogs(addons, ['audiobook']);
  const query = [want.name, want.author].filter(Boolean).join(' ');
  const settled = await Promise.allSettled(
    refs.map((ref) => fetchCatalog(fetcher, ref, { search: query })),
  );
  const seen = new Set<string>();
  const previews = settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((m) => {
      const id = `${m.type}:${m.id}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const authors = splitAuthors(want.author);
  const ranked = rankVolumes(previews, authors, want.number).slice(0, METAS_READ);
  const metas = await Promise.allSettled(
    ranked.map((m) => fetchMeta(fetcher, addons, m.type, m.id)),
  );
  const key = seriesKey(want.name);
  for (const [i, result] of metas.entries()) {
    const meta = result.status === 'fulfilled' ? result.value?.meta : undefined;
    if (!meta) continue;
    const named = (meta.series ?? []).some(
      (s) => seriesKey(s.name) === key && seriesNumber(s.position) === want.number,
    );
    if (!named) continue;
    const preview = ranked[i];
    return {
      type: meta.type,
      id: meta.id,
      name: meta.name,
      ...(meta.author
        ? { author: meta.author }
        : preview?.author
          ? { author: preview.author }
          : {}),
      ...(meta.cover ? { cover: meta.cover } : {}),
    };
  }
  return null;
}

/**
 * Search results most likely to be that number first: a title that carries the number, then
 * one by the same author. Results by someone else are left out when both sides name an author.
 */
export function rankVolumes(
  previews: readonly MetaPreview[],
  authors: readonly string[],
  number: number,
): MetaPreview[] {
  const score = (m: MetaPreview) => {
    const theirs = splitAuthors(m.author);
    const same = authors.length > 0 && theirs.length > 0 && sameAuthors(authors, theirs);
    return (titleKey(m.name).number === number ? 2 : 0) + (same ? 1 : 0);
  };
  return previews
    .filter((m) => {
      if (m.type !== 'audiobook') return false;
      const theirs = splitAuthors(m.author);
      return authors.length === 0 || theirs.length === 0 || sameAuthors(authors, theirs);
    })
    .map((m, i) => ({ m, i, s: score(m) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ m }) => m);
}
