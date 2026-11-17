import type { MetaPreview } from '@lelap/sdk';
import type { useRouter } from 'expo-router';

import { wideNow } from './layout';

type Router = ReturnType<typeof useRouter>;

/** Opens an add-on item's page. */
export function openItem(router: Router, meta: Pick<MetaPreview, 'type' | 'id'>): void {
  if (meta.type === 'podcast') router.push({ pathname: '/podcast', params: { item: meta.id } });
  else router.push({ pathname: '/item', params: { type: meta.type, id: meta.id } });
}

/** Opens Discover on a catalog. */
export function openCatalog(router: Router, addonUrl: string, catalogId: string): void {
  router.push({ pathname: '/discover', params: { addon: addonUrl, catalog: catalogId } });
}

/** Shows the player: full screen on a phone; on a wide screen it is already beside the list. */
export function openPlayer(router: Router): void {
  if (!wideNow()) router.push('/player');
}
