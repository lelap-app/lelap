import type { MetaPreview } from '@lelap/sdk';
import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/** Opens an add-on item's page. */
export function openItem(router: Router, meta: Pick<MetaPreview, 'type' | 'id'>): void {
  router.push({ pathname: '/item', params: { type: meta.type, id: meta.id } });
}

/** Opens Discover on a catalog. */
export function openCatalog(router: Router, addonUrl: string, catalogId: string): void {
  router.push({ pathname: '/discover', params: { addon: addonUrl, catalog: catalogId } });
}
