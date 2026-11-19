import { fold, type MetaPreview, sameAuthors, splitAuthors, titleKey } from '@lelap/sdk';

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

/** A book of a series to look for: its number, and its title when a series list names it (M127). */
export type WantedVolume = {
  name: string;
  author: string | null;
  number: number | null;
  /** Every title the book goes by, the one to search with first. */
  titles?: readonly string[];
};

const sameTitle = (a: string, b: string) => {
  const left = titleKey(a);
  const right = titleKey(b);
  return left.main.length >= 2 && (left.full === right.full || left.main === right.main);
};

/**
 * Looks in the add-ons' search catalogs for one book of a series (M109), only when the listener
 * asks: the search sends the book's title (M127) or else the series' name, with the author,
 * nothing else from the library. A result counts when its meta names the same series at that
 * number, or carries one of the book's titles.
 */
export async function findSeriesVolume(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  want: WantedVolume,
): Promise<SeriesVolume | null> {
  const titles = (want.titles ?? []).filter((t) => t.trim().length > 0);
  const searches = [
    ...titles.slice(0, 2).map((title) => [title, want.author]),
    ...(want.number !== null ? [[want.name, want.author]] : []),
  ].map((parts) => parts.filter(Boolean).join(' '));
  for (const query of [...new Set(searches)]) {
    const found = await searchFor(fetcher, addons, want, titles, query);
    if (found) return found;
  }
  return null;
}

async function searchFor(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  want: WantedVolume,
  titles: readonly string[],
  query: string,
): Promise<SeriesVolume | null> {
  const refs = searchCatalogs(addons, ['audiobook']);
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
  const ranked = rankVolumes(previews, authors, want.number, titles).slice(0, METAS_READ);
  const metas = await Promise.allSettled(
    ranked.map((m) => fetchMeta(fetcher, addons, m.type, m.id)),
  );
  const key = seriesKey(want.name);
  const fits = metas.map((result, i) => {
    const meta = result.status === 'fulfilled' ? result.value?.meta : undefined;
    if (!meta) return { meta, named: false, titled: false };
    const named =
      want.number !== null &&
      (meta.series ?? []).some(
        (s) => seriesKey(s.name) === key && seriesNumber(s.position) === want.number,
      );
    const theirs = splitAuthors(meta.author ?? ranked[i]?.author);
    const titled =
      titles.some((t) => sameTitle(t, meta.name)) &&
      (authors.length === 0 || theirs.length === 0 || sameAuthors(authors, theirs));
    return { meta, named, titled };
  });
  // A work whose meta names the series at that number beats one that only has the title.
  const named = fits.findIndex((f) => f.named);
  const at = named >= 0 ? named : fits.findIndex((f) => f.titled);
  const meta = fits[at]?.meta;
  if (meta) {
    const preview = ranked[at];
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
 * Search results most likely to be that book first: one of its titles as it is, then after
 * folding, a title that carries the number, then one by the same author. Results by someone else
 * are left out when both sides name
 * an author.
 */
export function rankVolumes(
  previews: readonly MetaPreview[],
  authors: readonly string[],
  number: number | null,
  titles: readonly string[] = [],
): MetaPreview[] {
  const score = (m: MetaPreview) => {
    const theirs = splitAuthors(m.author);
    const same = authors.length > 0 && theirs.length > 0 && sameAuthors(authors, theirs);
    const titled = titles.some((t) => sameTitle(t, m.name));
    // The title as it is, before one with a part or an edition note in it.
    const exact = titles.some((t) => fold(t) === fold(m.name));
    return (
      (exact ? 8 : 0) +
      (titled ? 4 : 0) +
      (number !== null && titleKey(m.name).number === number ? 2 : 0) +
      (same ? 1 : 0)
    );
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
