import {
  type Addon,
  type CatalogResponse,
  type ContentType,
  CORS_HEADERS,
  createAddon,
  type Manifest,
  type StreamResponse,
} from '@lelap/sdk';

import { metadataUrl } from '../librivox/archive';
import { searchWords } from '../text';
import { TTL, type Upstream } from '../upstream';
import {
  type Item,
  LECTURES,
  OLD_TIME_RADIO,
  parseItem,
  parseSearch,
  PREFIX,
  READINGS,
  searchUrl,
  SPOKEN_WORD,
  toFeed,
  toMeta,
  toPreview,
  toStream,
  wordsQuery,
} from './archive';

export const BASE_PATH = '/internet-archive';
export const PAGE_SIZE = 30;

const browse = [{ name: 'skip' }];
const search = [{ name: 'search', isRequired: true }, { name: 'skip' }];

export const manifest: Manifest = {
  id: 'app.lelap.internet-archive',
  version: '1.0.0',
  protocol: 1,
  name: 'Internet Archive',
  description:
    'Old-time radio, lectures and readings from archive.org: only items in the public domain or under a Creative Commons licence.',
  types: ['podcast', 'audiobook'],
  resources: [
    'catalog',
    { name: 'meta', types: ['podcast', 'audiobook'], idPrefixes: [PREFIX] },
    { name: 'stream', types: ['audiobook'], idPrefixes: [PREFIX] },
  ],
  idPrefixes: [PREFIX],
  catalogs: [
    { type: 'podcast', id: 'old-time-radio', name: 'Old-time radio', extra: browse },
    { type: 'audiobook', id: 'lectures', name: 'Lectures and talks', extra: browse },
    { type: 'audiobook', id: 'readings', name: 'Readings and poetry', extra: browse },
    { type: 'podcast', id: 'old-time-radio-search', name: 'Old-time radio', extra: search },
    { type: 'audiobook', id: 'search', name: 'Internet Archive', extra: search },
  ],
};

const SCOPES: Record<string, { type: ContentType; scope: string }> = {
  'old-time-radio': { type: 'podcast', scope: OLD_TIME_RADIO },
  lectures: { type: 'audiobook', scope: LECTURES },
  readings: { type: 'audiobook', scope: READINGS },
  'old-time-radio-search': { type: 'podcast', scope: OLD_TIME_RADIO },
  search: { type: 'audiobook', scope: SPOKEN_WORD },
};

function pageOf(skip: string | undefined): number {
  const value = Math.max(0, parseInt(skip ?? '0', 10) || 0);
  return Math.floor(value / PAGE_SIZE) + 1;
}

const FEED = /^\/feed\/([^/]+)\.xml$/;
// archive.org identifiers; anything else is not asked for upstream.
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Where this add-on serves the feed of a podcast item, on the origin the request came to. */
export function feedUrl(request: Request, identifier: string): string {
  return `${new URL(request.url).origin}${BASE_PATH}/feed/${encodeURIComponent(identifier)}.xml`;
}

/**
 * The Internet Archive add-on: the protocol from the SDK, plus `/feed/{identifier}.xml`, an RSS
 * feed of a podcast item's files that the app subscribes to. Audio links go to archive.org.
 */
export function createInternetArchiveAddon(upstream: Upstream): Addon {
  const item = async (identifier: string): Promise<Item | null> => {
    if (!IDENTIFIER.test(identifier)) return null;
    const found = parseItem(await upstream.json(metadataUrl(identifier), { ttl: TTL.item }));
    // The meta's ID and the feed's address must name the same item.
    return found?.metadata.identifier === identifier ? found : null;
  };

  const addon = createAddon(
    {
      manifest,
      async catalog({ id, extra }): Promise<CatalogResponse> {
        const scope = SCOPES[id];
        if (!scope) return { metas: [], cacheMaxAge: TTL.catalog };
        let words: string | undefined;
        if (id.endsWith('search')) {
          const found = searchWords(extra.search ?? '');
          if (found.length === 0) return { metas: [], cacheMaxAge: TTL.catalog };
          words = wordsQuery(found);
        }
        const data = await upstream.json(
          searchUrl({
            scope: scope.scope,
            ...(words ? { words } : { sort: 'downloads desc' }),
            rows: PAGE_SIZE,
            page: pageOf(extra.skip),
          }),
          { ttl: TTL.catalog },
        );
        const metas = parseSearch(data).flatMap((doc) => toPreview(doc, scope.type) ?? []);
        return { metas, cacheMaxAge: TTL.catalog };
      },
      async meta({ id, request }) {
        if (!id.startsWith(PREFIX)) return null;
        const identifier = id.slice(PREFIX.length);
        const found = await item(identifier);
        const meta = found ? toMeta(found, feedUrl(request, identifier)) : null;
        return meta ? { meta, cacheMaxAge: TTL.item } : null;
      },
      async stream({ id }): Promise<StreamResponse> {
        if (!id.startsWith(PREFIX)) return { streams: [], cacheMaxAge: TTL.item };
        const found = await item(id.slice(PREFIX.length));
        const stream = found?.type === 'audiobook' ? toStream(found) : null;
        return { streams: stream ? [stream] : [], cacheMaxAge: TTL.item };
      },
    },
    { basePath: BASE_PATH, onError: (error) => console.error(error) },
  );

  const serveFeed = async (request: Request, identifier: string): Promise<Response> => {
    const notFound = () =>
      new Response('Not found', {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    const found = await item(identifier);
    const xml = found?.type === 'podcast' ? toFeed(found, feedUrl(request, identifier)) : null;
    if (!xml) return notFound();
    return new Response(request.method === 'HEAD' ? null : xml, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': `public, max-age=${TTL.catalog}`,
      },
    });
  };

  return {
    manifest,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const match = pathname.startsWith(BASE_PATH)
        ? pathname.slice(BASE_PATH.length).match(FEED)
        : null;
      if (match && (request.method === 'GET' || request.method === 'HEAD')) {
        let identifier: string;
        try {
          identifier = decodeURIComponent(match[1] ?? '');
        } catch {
          identifier = '';
        }
        try {
          return await serveFeed(request, identifier);
        } catch (error) {
          console.error(error);
          return new Response('archive.org did not answer. Try again later.', {
            status: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      }
      return addon.fetch(request);
    },
  };
}
