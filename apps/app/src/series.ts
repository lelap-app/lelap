import {
  fetchSeriesList,
  findSeriesVolume,
  keepSeriesList,
  linkedOpenLibraryWork,
  seriesKey,
  seriesListDue,
  seriesOfBook,
  storedSeriesList,
  type WantedVolume,
} from '@lelap/core';
import type { SeriesList } from '@lelap/sdk';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetcher, useAddons } from './addons';
import { db } from './db';
import { showAlert } from './dialog';
import { currentLanguage, t } from './i18n';
import { openItem } from './navigation';
import { profileId } from './profile';

/** A series' position for people: “book 2”, or the label itself when it is no number. */
export const bookNumber = (position: string) => t('Book {n}', { n: position });

/** Series asked for during this run, so two screens never ask at once. */
const asking = new Map<string, Promise<void>>();
/** When asking last failed, per series and language: not again for a while in this run. */
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * The whole series from the add-ons (M127), kept on the device: the last answer at once, then a
 * fresh one when it is a month old or was never asked. The request names the series, its author,
 * the profile's language and an Open Library work the listener linked to one of its books.
 */
export function useSeriesList(
  series: { key: string; name: string; author: string | null; bookKeys?: string[] } | null,
): { list: SeriesList | null; asking: boolean } {
  const addons = useAddons();
  const language = currentLanguage();
  // Plain values, as `series` is a new object with every library version.
  const key = series?.key ?? null;
  const name = series?.name ?? '';
  const author = series?.author ?? null;
  const bookKeys = series?.bookKeys?.join('\n') ?? '';
  const id = key ? `${key}\n${language}` : null;
  // The add-ons change with every library version; the request reads the latest when it starts.
  const addonsRef = useRef(addons);
  addonsRef.current = addons;
  // Kept with the series it is for, so another series never shows this one's list.
  const [kept, setKept] = useState<{ id: string | null; list: SeriesList | null }>(() => ({
    id,
    list: key ? (storedSeriesList(db, key, language)?.list ?? null) : null,
  }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!key || !id) {
      setKept({ id, list: null });
      setBusy(false);
      return;
    }
    const read = () => setKept({ id, list: storedSeriesList(db, key, language)?.list ?? null });
    read();
    const now = Date.now();
    const due =
      seriesListDue(storedSeriesList(db, key, language), now) &&
      now - (failedAt.get(id) ?? 0) > RETRY_AFTER_MS;
    if (!due && !asking.has(id)) {
      setBusy(false);
      return;
    }
    let live = true;
    setBusy(true);
    const job =
      asking.get(id) ??
      (async () => {
        const work = linkedOpenLibraryWork(db, bookKeys ? bookKeys.split('\n') : []);
        const answer = await fetchSeriesList(fetcher, addonsRef.current, {
          name,
          author,
          language,
          work,
        });
        // Offline, or every add-on failed: keep what was there and ask again later.
        if (answer === undefined) failedAt.set(id, Date.now());
        else keepSeriesList(db, key, language, answer, Date.now());
      })()
        .catch(() => {
          failedAt.set(id, Date.now());
        })
        .finally(() => asking.delete(id));
    asking.set(id, job);
    void job.then(() => {
      if (!live) return;
      read();
      setBusy(false);
    });
    return () => {
      live = false;
    };
  }, [id, key, name, author, bookKeys, language]);

  const list =
    kept.id === id ? kept.list : key ? (storedSeriesList(db, key, language)?.list ?? null) : null;
  return { list, asking: busy };
}

/**
 * Looks in the add-ons for a book the library lacks (M109) and opens its page; says so when no
 * add-on has it. Only on the listener's tap: the search names the book's title (M127) or the
 * series, and the author.
 */
export function useFindVolume() {
  const router = useRouter();
  const addons = useAddons();
  const [looking, setLooking] = useState<string | null>(null);
  const find = useCallback(
    async (
      series: { name: string; author: string | null },
      volume: { number: number | null; titles?: string[]; id: string },
    ) => {
      setLooking(volume.id);
      const want: WantedVolume = {
        ...series,
        number: volume.number,
        ...(volume.titles ? { titles: volume.titles } : {}),
      };
      try {
        const found = await findSeriesVolume(fetcher, addons, want);
        if (found) openItem(router, found);
        else {
          const title = volume.titles?.[0];
          showAlert(
            t('Not found'),
            title
              ? t('None of your add-ons lists {title}.', { title })
              : t('None of your add-ons lists book {n} of {series}.', {
                  n: volume.number ?? '',
                  series: series.name,
                }),
          );
        }
      } catch (error) {
        showAlert(t('Not found'), error instanceof Error ? error.message : String(error));
      } finally {
        setLooking(null);
      }
    },
    [addons, router],
  );
  return { find, looking };
}

/** Opens the page of a book's series, the one it names first. */
export function openSeriesOf(
  router: ReturnType<typeof useRouter>,
  bookId: string,
  name?: string,
): void {
  const all = seriesOfBook(db, profileId, bookId);
  const wanted = name ? seriesKey(name) : null;
  const series = all.find((s) => wanted !== null && s.keys.includes(wanted)) ?? all[0];
  if (series) router.push({ pathname: '/series', params: { key: series.key } });
}
