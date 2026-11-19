import { type Addon, type CatalogResponse, createAddon, type Manifest } from '@lelap/sdk';

import {
  createPodcastIndex,
  type Feed,
  type PodcastIndex,
  type PodcastIndexCredentials,
  PREFIX,
} from '../podcastindex';
import { TTL, type Upstream } from '../upstream';

export const BASE_PATH = '/lepak';
const SEARCH = 'lepak-search';
const ROW_SIZE = 20;
// A listing is filtered again after it arrives, so ask for more than a row holds.
const LISTING_SIZE = 40;
const SEARCH_SIZE = 60;
const PAGE_SIZE = 30;

// Region forms too: whether `lang=ms` also matches feeds that say `ms-MY` is not documented.
// `in` is the old code for Indonesian, which some feed tools still write.
const MALAY_INDONESIAN = 'ms,ms-my,ms-sg,ms-bn,id,id-id,in';
const SINGAPORE = 'en-sg,zh-sg,ms-sg,ta-sg';

type Row = {
  id: string;
  name: string;
  lang: string;
  /** Category names from Podcast Index's `categories/list`, any of them. */
  cat?: string;
  keep: (language: string) => boolean;
};

const baseOf = (language: string) => language.trim().toLowerCase().split(/[-_]/)[0] ?? '';

/** Malay or Indonesian, whatever the region. */
export const isMalayOrIndonesian = (language: string): boolean =>
  ['ms', 'id', 'in'].includes(baseOf(language));

/**
 * A Singapore language tag. Feeds that only say `en` or `zh` can't be told apart from any other
 * English or Chinese show, so they are left out.
 */
export const isSingaporean = (language: string): boolean => /[-_]sg$/i.test(language.trim());

const ROWS: Row[] = [
  {
    id: 'cerita',
    name: 'Cerita',
    lang: MALAY_INDONESIAN,
    cat: 'Fiction,Drama,Stories',
    keep: isMalayOrIndonesian,
  },
  {
    id: 'sembang',
    name: 'Sembang',
    lang: MALAY_INDONESIAN,
    cat: 'Society,Culture,Comedy,Leisure',
    keep: isMalayOrIndonesian,
  },
  {
    id: 'sejarah',
    name: 'Sejarah',
    lang: MALAY_INDONESIAN,
    cat: 'History',
    keep: isMalayOrIndonesian,
  },
  { id: 'singapura', name: 'Singapura', lang: SINGAPORE, keep: isSingaporean },
];

/**
 * Lepak (M131): free podcasts in Malay and Indonesian, and from Singapore, from Podcast Index by
 * language. The names are Malay; the description is English. Podcasts only, no books.
 */
export const lepakManifest: Manifest = {
  id: 'app.lelap.lepak',
  version: '1.0.0',
  protocol: 1,
  name: 'Lepak',
  description:
    'Free podcasts in Malay and Indonesian, and from Singapore, from Podcast Index: Cerita for stories and drama, Sembang for talk, Sejarah for history, and Singapura.',
  types: ['podcast'],
  resources: ['catalog', { name: 'meta', types: ['podcast'], idPrefixes: [PREFIX] }],
  idPrefixes: [PREFIX],
  catalogs: [
    ...ROWS.map((row) => ({ type: 'podcast' as const, id: row.id, name: row.name })),
    { type: 'podcast', id: SEARCH, name: 'Lepak', extra: [{ name: 'search', isRequired: true }] },
  ],
};

const keptBy = (keep: (language: string) => boolean) => (feed: Feed) =>
  feed.language !== undefined && keep(feed.language);

/** Trending shows first; recently updated ones fill the row when too few are trending. */
async function rowFeeds(podcasts: PodcastIndex, row: Row): Promise<Feed[]> {
  const filter = {
    lang: row.lang,
    max: LISTING_SIZE,
    ttl: TTL.item,
    ...(row.cat ? { cat: row.cat } : {}),
  };
  const kept = (await podcasts.feeds('podcasts/trending', filter)).filter(keptBy(row.keep));
  if (kept.length < ROW_SIZE) {
    const seen = new Set(kept.map((f) => f.id));
    const recent = await podcasts.feeds('recent/feeds', filter);
    for (const feed of recent.filter(keptBy(row.keep))) {
      if (seen.has(feed.id)) continue;
      seen.add(feed.id);
      kept.push(feed);
    }
  }
  return kept.slice(0, ROW_SIZE);
}

export function createLepakAddon(upstream: Upstream, credentials: PodcastIndexCredentials): Addon {
  const podcasts = createPodcastIndex(upstream, credentials);
  const rows = new Map(ROWS.map((row) => [row.id, row]));
  return createAddon(
    {
      manifest: lepakManifest,
      async catalog({ id, extra }): Promise<CatalogResponse> {
        const row = rows.get(id);
        if (row) {
          const metas = await podcasts.previews(await rowFeeds(podcasts, row));
          return { metas, cacheMaxAge: TTL.item };
        }
        const search = extra.search?.trim() ?? '';
        if (id !== SEARCH || !search) return { metas: [], cacheMaxAge: TTL.catalog };
        // `search/byterm` has no language filter, so each feed's own `language` decides.
        const feeds = (await podcasts.searchFeeds(search, SEARCH_SIZE))
          .filter(keptBy((l) => isMalayOrIndonesian(l) || isSingaporean(l)))
          .slice(0, PAGE_SIZE);
        return { metas: await podcasts.previews(feeds), cacheMaxAge: TTL.catalog };
      },
      async meta({ type, id }) {
        const meta = type === 'podcast' ? await podcasts.meta(id) : null;
        return meta ? { meta, cacheMaxAge: TTL.item } : null;
      },
    },
    { basePath: BASE_PATH, onError: (error) => console.error(error) },
  );
}
