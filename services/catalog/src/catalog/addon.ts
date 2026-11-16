import {
  type Addon,
  type CatalogDefinition,
  type CatalogResponse,
  type ContentType,
  createAddon,
  type Manifest,
} from '@lelap/sdk';

import * as openLibrary from '../openlibrary';
import {
  createPodcastIndex,
  type PodcastIndexCredentials,
  PREFIX as PODCAST,
} from '../podcastindex';
import { TTL, type Upstream } from '../upstream';

const OPEN_LIBRARY_CATALOGS: CatalogDefinition[] = [
  {
    type: 'audiobook',
    id: 'openlibrary-search',
    name: 'Open Library',
    extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
  },
];

const PODCAST_CATALOGS: CatalogDefinition[] = [
  { type: 'podcast', id: 'trending', name: 'Trending podcasts' },
  {
    type: 'podcast',
    id: 'podcast-search',
    name: 'Podcasts',
    extra: [{ name: 'search', isRequired: true }],
  },
];

/** Podcast Index only appears when both of its secrets are configured. */
export function catalogManifest(podcasts: boolean): Manifest {
  const types: ContentType[] = podcasts ? ['audiobook', 'podcast'] : ['audiobook'];
  const idPrefixes = podcasts ? [openLibrary.PREFIX, PODCAST] : [openLibrary.PREFIX];
  return {
    id: 'app.lelap.catalog',
    version: '1.0.0',
    protocol: 1,
    name: 'Catalog',
    description: podcasts
      ? 'Books from Open Library and podcasts from Podcast Index.'
      : 'Books from Open Library.',
    types,
    resources: ['catalog', { name: 'meta', types, idPrefixes }],
    idPrefixes,
    catalogs: podcasts ? [...OPEN_LIBRARY_CATALOGS, ...PODCAST_CATALOGS] : OPEN_LIBRARY_CATALOGS,
  };
}

export function createCatalogAddon(
  upstream: Upstream,
  podcastIndex: PodcastIndexCredentials | null,
): Addon {
  const podcasts = podcastIndex ? createPodcastIndex(upstream, podcastIndex) : null;

  return createAddon(
    {
      manifest: catalogManifest(podcasts !== null),
      async catalog({ id, extra }): Promise<CatalogResponse> {
        const search = extra.search?.trim() ?? '';
        if (id === 'openlibrary-search') {
          if (!search) return { metas: [], cacheMaxAge: TTL.catalog };
          const skip = Math.max(0, parseInt(extra.skip ?? '0', 10) || 0);
          const data = await upstream.json(openLibrary.searchUrl(search, skip), {
            ttl: TTL.catalog,
          });
          return { metas: openLibrary.parseSearch(data), cacheMaxAge: TTL.catalog };
        }
        if (podcasts && id === 'trending')
          return { metas: await podcasts.trending(), cacheMaxAge: TTL.catalog };
        if (podcasts && id === 'podcast-search')
          return {
            metas: search ? await podcasts.search(search) : [],
            cacheMaxAge: TTL.catalog,
          };
        return { metas: [], cacheMaxAge: TTL.catalog };
      },
      async meta({ type, id }) {
        const meta =
          type === 'audiobook'
            ? await openLibrary.workMeta(upstream, id)
            : type === 'podcast' && podcasts
              ? await podcasts.meta(id)
              : null;
        return meta ? { meta, cacheMaxAge: TTL.item } : null;
      },
    },
    { onError: (error) => console.error(error) },
  );
}
