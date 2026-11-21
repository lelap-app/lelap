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
// The Catalog's podcast search asks the same, so both share one cached answer.
const SEARCH_SIZE = 30;

// Region forms too: whether `lang=ms` also matches feeds that say `ms-MY` is not documented.
// `in` is the old code for Indonesian, which some feed tools still write. RSS `<language>` takes
// two-letter codes, so three-letter ones (`ind`, `msa`) are left out.
const MALAY_INDONESIAN = 'ms,ms-my,ms-sg,ms-bn,id,id-id,in,in-id';
const SINGAPORE = 'en-sg,zh-sg,ms-sg,ta-sg';

type Row = {
  id: string;
  name: string;
  lang: string;
  /** Category names from Podcast Index's `categories/list`, any of them. */
  cat?: string;
  /** Searched when trending and recent feeds leave the row short: few feeds in these languages
   * carry the category, while their titles say the word. */
  term?: string;
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
    term: 'cerita',
    cat: 'Fiction,Drama,Stories',
    keep: isMalayOrIndonesian,
  },
  {
    id: 'sembang',
    name: 'Sembang',
    lang: MALAY_INDONESIAN,
    term: 'sembang',
    cat: 'Society,Culture,Comedy,Leisure',
    keep: isMalayOrIndonesian,
  },
  {
    id: 'sejarah',
    name: 'Sejarah',
    lang: MALAY_INDONESIAN,
    term: 'sejarah',
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
  // Meta too, so its shows open when a listener has removed the Catalog.
  resources: ['catalog', { name: 'meta', types: ['podcast'], idPrefixes: [PREFIX] }],
  idPrefixes: [PREFIX],
  catalogs: [
    ...ROWS.map((row) => ({ type: 'podcast' as const, id: row.id, name: row.name })),
    { type: 'podcast', id: SEARCH, name: 'Lepak', extra: [{ name: 'search', isRequired: true }] },
  ],
};

const keptBy = (keep: (language: string) => boolean) => (feed: Feed) =>
  feed.language !== undefined && keep(feed.language);

/**
 * Trending shows first; recently updated ones, then a search for the row's word, fill the row when
 * too few are trending. `failed` when a top-up failed, so the row is kept briefly instead of for a
 * day.
 */
async function rowFeeds(
  podcasts: PodcastIndex,
  row: Row,
): Promise<{ feeds: Feed[]; failed: boolean }> {
  // A day, not the Catalog's 6 hours: these lists are short and change slowly.
  const filter = {
    lang: row.lang,
    max: LISTING_SIZE,
    ttl: TTL.item,
    ...(row.cat ? { cat: row.cat } : {}),
  };
  const kept = (await podcasts.feeds('podcasts/trending', filter)).filter(keptBy(row.keep));
  let failed = false;
  const seen = new Set(kept.map((f) => f.id));
  const topUp = async (more: () => Promise<Feed[]>) => {
    if (kept.length >= ROW_SIZE) return;
    const feeds = await more().catch(() => {
      failed = true;
      return [];
    });
    for (const feed of feeds.filter(keptBy(row.keep))) {
      if (seen.has(feed.id)) continue;
      seen.add(feed.id);
      kept.push(feed);
    }
  };
  await topUp(() => podcasts.feeds('recent/feeds', filter));
  // The same question as Lepak's search for the word, so one cached answer serves both.
  const { term } = row;
  if (term) await topUp(() => podcasts.searchFeeds(term, SEARCH_SIZE));
  return { feeds: kept.slice(0, ROW_SIZE), failed };
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
          const { feeds, failed } = await rowFeeds(podcasts, row);
          const metas = await podcasts.previews(feeds);
          // Fewer previews than feeds: a lookup failed (or a feed has no GUID); ask again soon.
          const whole = !failed && metas.length === feeds.length;
          return { metas, cacheMaxAge: whole ? TTL.item : TTL.failure };
        }
        const search = extra.search?.trim() ?? '';
        if (id !== SEARCH || !search) return { metas: [], cacheMaxAge: TTL.catalog };
        // `search/byterm` has no language filter, so each feed's own `language` decides.
        const feeds = (await podcasts.searchFeeds(search, SEARCH_SIZE)).filter(
          keptBy((l) => isMalayOrIndonesian(l) || isSingaporean(l)),
        );
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
