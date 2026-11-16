import {
  catalogPath,
  type CatalogDefinition,
  type ContentType,
  type Extra,
  Manifest,
  Meta,
  MetaPreview,
  metaPath,
  Stream,
  streamPath,
  supports,
} from '@lelap/sdk';

/** What the client needs from `fetch`; tests pass a fake. */
export type Fetcher = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type InstalledAddon = {
  id: string;
  /** The manifest URL. */
  url: string;
  manifest: Manifest;
  builtin: boolean;
};

export type CatalogRef = { addon: InstalledAddon; catalog: CatalogDefinition };

export const REQUEST_TIMEOUT_MS = 10_000;

export class AddonRequestError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** The base every resource path is relative to: the manifest URL without `manifest.json`. */
export function addonBase(manifestUrl: string): string {
  return manifestUrl.replace(/manifest\.json(\?.*)?$/, '');
}

/** Accepts what people paste: with or without `manifest.json`, `lelap://` or a trailing slash. */
export function normalizeManifestUrl(input: string): string | null {
  // String work only: React Native's URL has no setters.
  let text = input.trim().replace(/^lelap:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  text = text.replace(/#.*$/, '');
  const match = /^(https?:\/\/[^/?#\s]+)([^?\s]*)(\?\S*)?$/i.exec(text);
  if (!match) return null;
  const [, origin = '', rawPath = '', query = ''] = match;
  if (
    !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) &&
    !/^https?:\/\/\[[0-9a-f:]+\](:\d+)?$/i.test(origin)
  )
    return null;
  const path = rawPath.endsWith('/manifest.json')
    ? rawPath
    : `${rawPath.replace(/\/+$/, '')}/manifest.json`;
  return `${origin.toLowerCase()}${path}${query}`;
}

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new AddonRequestError(url, response.status, `The add-on answered ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof AddonRequestError) throw error;
    const message = controller.signal.aborted
      ? 'The add-on took too long to answer'
      : 'The add-on could not be reached';
    throw new AddonRequestError(url, null, message);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchManifest(fetcher: Fetcher, manifestUrl: string): Promise<Manifest> {
  const parsed = Manifest.safeParse(await getJson(fetcher, manifestUrl));
  if (!parsed.success)
    throw new AddonRequestError(manifestUrl, null, 'This is not a Lelap add-on manifest');
  return parsed.data;
}

/** Keeps the valid entries of a list, so one bad item does not hide a whole catalog. */
function validEntries<T>(value: unknown, key: string, parse: (item: unknown) => T | null): T[] {
  if (typeof value !== 'object' || value === null) return [];
  const list = (value as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const parsed = parse(item);
    return parsed === null ? [] : [parsed];
  });
}

const parseWith =
  <T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }) =>
  (item: unknown): T | null => {
    const result = schema.safeParse(item);
    return result.success ? result.data : null;
  };

const requiredExtras = (catalog: CatalogDefinition) =>
  (catalog.extra ?? []).filter((e) => e.isRequired).map((e) => e.name);

/** Catalogs that list something without input, for Home rows and Discover. */
export function browseCatalogs(addons: InstalledAddon[], types: ContentType[]): CatalogRef[] {
  return addons.flatMap((addon) =>
    addon.manifest.catalogs
      .filter((catalog) => types.includes(catalog.type) && requiredExtras(catalog).length === 0)
      .map((catalog) => ({ addon, catalog })),
  );
}

/** Catalogs that take a `search` extra and need nothing else. */
export function searchCatalogs(addons: InstalledAddon[], types: ContentType[]): CatalogRef[] {
  return addons.flatMap((addon) =>
    addon.manifest.catalogs
      .filter(
        (catalog) =>
          types.includes(catalog.type) &&
          (catalog.extra ?? []).some((e) => e.name === 'search') &&
          requiredExtras(catalog).every((name) => name === 'search'),
      )
      .map((catalog) => ({ addon, catalog })),
  );
}

/** The `genre` options a catalog offers, if any. */
export function genreOptions(catalog: CatalogDefinition): string[] {
  return catalog.extra?.find((e) => e.name === 'genre')?.options ?? [];
}

export async function fetchCatalog(
  fetcher: Fetcher,
  ref: CatalogRef,
  extra: Extra = {},
): Promise<MetaPreview[]> {
  const url = addonBase(ref.addon.url) + catalogPath(ref.catalog.type, ref.catalog.id, extra);
  return validEntries(await getJson(fetcher, url), 'metas', parseWith(MetaPreview));
}

export type SearchResult = { ref: CatalogRef; metas: MetaPreview[]; error: string | null };

/** Searches every search catalog at once; a failing add-on shows as an error, not a failure. */
export async function searchAll(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  query: string,
  types: ContentType[],
): Promise<SearchResult[]> {
  const refs = searchCatalogs(addons, types);
  const settled = await Promise.allSettled(
    refs.map((ref) => fetchCatalog(fetcher, ref, { search: query })),
  );
  return refs.map((ref, index) => {
    const result = settled[index];
    return result?.status === 'fulfilled'
      ? { ref, metas: result.value, error: null }
      : {
          ref,
          metas: [],
          error: result?.reason instanceof Error ? result.reason.message : 'Search failed',
        };
  });
}

/** Meta from the first add-on that answers for this ID. */
export async function fetchMeta(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
): Promise<{ addon: InstalledAddon; meta: Meta } | null> {
  let lastError: unknown = null;
  for (const addon of addons.filter((a) => supports(a.manifest, 'meta', type, id))) {
    try {
      const body = await getJson(fetcher, addonBase(addon.url) + metaPath(type, id));
      const parsed = Meta.safeParse(
        typeof body === 'object' && body !== null ? (body as { meta?: unknown }).meta : null,
      );
      if (parsed.success) return { addon, meta: parsed.data };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

export type FoundStream = { addon: InstalledAddon; stream: Stream };

/** Streams from every add-on that answers for this ID, in add-on order. */
export async function fetchStreams(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
): Promise<FoundStream[]> {
  const sources = addons.filter((a) => supports(a.manifest, 'stream', type, id));
  const settled = await Promise.allSettled(
    sources.map(async (addon) =>
      validEntries(
        await getJson(fetcher, addonBase(addon.url) + streamPath(type, id)),
        'streams',
        parseWith(Stream),
      ).map((stream) => ({ addon, stream })),
    ),
  );
  const found = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (found.length === 0) {
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return found;
}
