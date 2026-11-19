import type { MetaPreview } from '@lelap/sdk';
import type { useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { columnsNow, playerBesideNow } from './layout';

type Router = ReturnType<typeof useRouter>;

/** A page that can stand in the middle column of a very wide window (M113). */
export type Page =
  | { pathname: '/item'; params: { type: string; id: string } }
  | { pathname: '/podcast'; params: { id?: string; item?: string } };

let detail: Page | null = null;
const listeners = new Set<() => void>();

function setDetail(page: Page | null): void {
  detail = page;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readDetail = () => detail;

/** The page in the middle column, or null when it is closed. */
export function useDetail(): Page | null {
  return useSyncExternalStore(subscribe, readDetail, readDetail);
}

export function closeDetail(): void {
  setDetail(null);
}

/**
 * Opens a book's or a show's page: in the middle column on a very wide window, so the list it
 * came from stays in view, else full screen.
 */
export function openPage(router: Router, page: Page): void {
  if (columnsNow() === 3) setDetail(page);
  else router.push(page);
}

/** Opens an add-on item's page. */
export function openItem(router: Router, meta: Pick<MetaPreview, 'type' | 'id'>): void {
  if (meta.type === 'podcast')
    openPage(router, { pathname: '/podcast', params: { item: meta.id } });
  else openPage(router, { pathname: '/item', params: { type: meta.type, id: meta.id } });
}

/** Opens Discover on a catalog. */
export function openCatalog(router: Router, addonUrl: string, catalogId: string): void {
  router.push({ pathname: '/discover', params: { addon: addonUrl, catalog: catalogId } });
}

/** Shows the player: full screen on a phone; on a wide screen it is already beside the list. */
export function openPlayer(router: Router): void {
  if (!playerBesideNow()) router.push('/player');
}
