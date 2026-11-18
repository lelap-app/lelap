import { findSeriesVolume, seriesKey, seriesOfBook } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetcher, useAddons } from './addons';
import { db } from './db';
import { showAlert } from './dialog';
import { t } from './i18n';
import { openItem } from './navigation';
import { profileId } from './profile';

/** A series' position for people: “book 2”, or the label itself when it is no number. */
export const bookNumber = (position: string) => t('Book {n}', { n: position });

/**
 * Looks in the add-ons for a number the library lacks (M109) and opens its page; says so when no
 * add-on has it. Only on the listener's tap: the search names the series and its author.
 */
export function useFindVolume() {
  const router = useRouter();
  const addons = useAddons();
  const [looking, setLooking] = useState<number | null>(null);
  const find = useCallback(
    async (series: { name: string; author: string | null }, number: number) => {
      setLooking(number);
      try {
        const found = await findSeriesVolume(fetcher, addons, { ...series, number });
        if (found) openItem(router, found);
        else {
          showAlert(
            t('Not found'),
            t('None of your add-ons lists book {n} of {series}.', {
              n: number,
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
