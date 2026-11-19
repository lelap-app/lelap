import {
  type Addon,
  type CatalogResponse,
  createAddon,
  type Manifest,
  type Stream,
  type StreamResponse,
} from '@lelap/sdk';

import { fetchWork, authorNames, workIdOf } from '../openlibrary';
import { searchWords } from '../text';
import { TTL, type Upstream } from '../upstream';
import {
  genreQuery,
  lookupQuery,
  metadataUrl,
  parseItem,
  parseDocs,
  parseSearch,
  searchDocs,
  PREFIX,
  searchUrl,
  toMeta,
  toPreview,
  toStream,
  wordsQuery,
} from './archive';

export const BASE_PATH = '/librivox';
export const PAGE_SIZE = 30;
const MAX_LOOKUP_MATCHES = 5;

/** archive.org subjects that LibriVox recordings commonly carry; each returns hundreds. */
export const GENRES = [
  'poetry',
  'children',
  'mystery',
  'fantasy',
  'science fiction',
  'history',
  'romance',
  'humor',
  'philosophy',
  'religion',
  'short stories',
  'adventure',
  'drama',
  'horror',
  'biography',
  'travel',
];

const browseExtras = [{ name: 'genre', options: GENRES }, { name: 'skip' }];

export const manifest: Manifest = {
  id: 'app.lelap.librivox',
  version: '1.0.0',
  protocol: 1,
  name: 'LibriVox',
  description: 'Free public-domain audiobooks read by LibriVox volunteers, served by archive.org.',
  types: ['audiobook'],
  resources: [
    'catalog',
    { name: 'meta', types: ['audiobook'], idPrefixes: [PREFIX] },
    { name: 'stream', types: ['audiobook'], idPrefixes: [PREFIX, 'ol:'] },
  ],
  idPrefixes: [PREFIX, 'ol:'],
  catalogs: [
    { type: 'audiobook', id: 'new', name: 'New on LibriVox', extra: browseExtras },
    { type: 'audiobook', id: 'popular', name: 'Most listened', extra: browseExtras },
    {
      type: 'audiobook',
      id: 'search',
      name: 'LibriVox',
      extra: [{ name: 'search', isRequired: true }, { name: 'skip' }],
    },
  ],
};

const SORTS: Record<string, string> = { new: 'publicdate desc', popular: 'downloads desc' };

const STOP_WORDS = new Set(['the', 'an', 'and', 'of', 'or', 'to', 'in', 'on', 'for', 'with']);

function skipOf(skip: string | undefined): number {
  return Math.max(0, parseInt(skip ?? '0', 10) || 0);
}

export function createLibrivoxAddon(upstream: Upstream): Addon {
  const itemStream = async (identifier: string): Promise<Stream | null> => {
    const item = parseItem(await upstream.json(metadataUrl(identifier), { ttl: TTL.item }));
    return item ? toStream(item) : null;
  };

  /** Recordings of an Open Library work: matched by title words and the author's surname. */
  const workStreams = async (workId: string): Promise<Stream[]> => {
    const work = await fetchWork(upstream, workId);
    if (!work?.title) return [];
    const titleWords = searchWords(work.title, 10).filter((word) => !STOP_WORDS.has(word));
    if (titleWords.length === 0) return [];
    const [author] = await authorNames(upstream, work, 1);
    const surname = searchWords(author ?? '').slice(-1);
    const data = await upstream.json(
      searchUrl({
        query: lookupQuery(titleWords, surname),
        sort: 'downloads desc',
        rows: MAX_LOOKUP_MATCHES,
        page: 1,
        fields: ['identifier'],
      }),
      { ttl: TTL.item },
    );
    const results = await Promise.allSettled(
      parseSearch(data).map((doc) => itemStream(doc.identifier)),
    );
    return results.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    );
  };

  return createAddon(
    {
      manifest,
      async catalog({ id, extra }): Promise<CatalogResponse> {
        let query: string;
        let sort: string | undefined;
        if (id === 'search') {
          const words = searchWords(extra.search ?? '');
          if (words.length === 0) return { metas: [], cacheMaxAge: TTL.catalog };
          query = wordsQuery(words);
        } else {
          sort = SORTS[id];
          const genre = extra.genre && GENRES.includes(extra.genre) ? extra.genre : undefined;
          query = genre ? genreQuery(genre) : '';
        }
        // archive.org pages by page number only. A skip between pages starts inside one page and
        // takes the rest from the next, so a short last page never comes back.
        const skip = skipOf(extra.skip);
        const page = Math.floor(skip / PAGE_SIZE) + 1;
        const offset = skip % PAGE_SIZE;
        const docsOf = async (number: number) =>
          searchDocs(
            await upstream.json(
              searchUrl({ query, rows: PAGE_SIZE, page: number, ...(sort ? { sort } : {}) }),
              { ttl: TTL.catalog },
            ),
          );
        let docs = (await docsOf(page)).slice(offset);
        if (offset > 0 && docs.length === PAGE_SIZE - offset)
          docs = [...docs, ...(await docsOf(page + 1))];
        const metas = parseDocs(docs.slice(0, PAGE_SIZE)).flatMap((doc) => toPreview(doc) ?? []);
        return { metas, cacheMaxAge: TTL.catalog };
      },
      async meta({ id }) {
        if (!id.startsWith(PREFIX)) return null;
        const identifier = id.slice(PREFIX.length);
        const item = parseItem(await upstream.json(metadataUrl(identifier), { ttl: TTL.item }));
        const meta = item ? toMeta(item) : null;
        return meta ? { meta, cacheMaxAge: TTL.item } : null;
      },
      async stream({ id }): Promise<StreamResponse> {
        if (id.startsWith(PREFIX)) {
          const stream = await itemStream(id.slice(PREFIX.length));
          return { streams: stream ? [stream] : [], cacheMaxAge: TTL.item };
        }
        const workId = workIdOf(id);
        if (!workId) return { streams: [], cacheMaxAge: TTL.item };
        try {
          return { streams: await workStreams(workId), cacheMaxAge: TTL.item };
        } catch {
          // Best effort: a failing lookup must not hide other add-ons' streams.
          return { streams: [], cacheMaxAge: TTL.failure };
        }
      },
    },
    { basePath: BASE_PATH, onError: (error) => console.error(error) },
  );
}
