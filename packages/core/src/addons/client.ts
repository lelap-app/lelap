import { isLocalAddonUrl } from './local';
import { readManifest } from './manifest';
import {
  type AddonBlock,
  addonBlock,
  addonRefusals,
  protocolHeaders,
  upgradeNote,
} from './revision';
import {
  ArtworkImage,
  artworkPath,
  catalogPath,
  type CatalogDefinition,
  type ContentType,
  type Extra,
  Manifest,
  Meta,
  MetaPreview,
  metaPath,
  offersSeries,
  type SeriesList,
  seriesPath,
  SeriesResponse,
  Stream,
  streamPath,
  WebStream,
  supports,
} from '@lelap/sdk';

/** What the client needs from `fetch`; tests pass a fake. */
export type Fetcher = (
  url: string,
  /** `cache: 'no-store'` asks past every cache, for a second look at a slow answer (M152). */
  init: { signal: AbortSignal; headers: Record<string, string>; cache?: 'no-store' },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  /** The body as text, for a `426`'s note; `fetch` has it, a fake may not. */
  text?(): Promise<string>;
  headers?: { get(name: string): string | null };
}>;

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

/**
 * The add-on won't work with this app (revision 15): its `minProtocolVersion` is above the app's
 * revision, so it was not asked, or it answered `426 Upgrade Required`. `block.note` is the
 * add-on's own words, when it sent short plain text.
 */
export class AddonUpgradeError extends AddonRequestError {
  constructor(
    url: string,
    readonly addonName: string,
    readonly block: AddonBlock,
  ) {
    super(url, block.kind === 'refused' ? 426 : null, `Update Lelap to use ${addonName}`);
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

/** The add-on a resource request goes to: its manifest decides the header and whether to ask. */
type AddonTarget = Pick<InstalledAddon, 'url' | 'manifest'>;

/** Reads a `426`'s short plain-text note; never throws. */
async function readUpgradeNote(response: Awaited<ReturnType<Fetcher>>): Promise<string | null> {
  try {
    const text = response.text ? await response.text() : null;
    return upgradeNote(text, response.headers?.get('content-type') ?? null);
  } catch {
    return null;
  }
}

/**
 * Whether the app may ask this add-on anything. A blocked add-on's catalogs show “Needs a newer
 * Lelap” instead; its meta, streams and covers are simply not asked.
 */
export const usableAddon = (addon: AddonTarget): boolean => addonBlock(addon) === null;

/**
 * A resource request. `addon` is null only for the manifest, which never carries the app's
 * revision: the app reads the revision an add-on declares from it.
 */
async function getJson(
  fetcher: Fetcher,
  addon: AddonTarget | null,
  url: string,
  fresh = false,
): Promise<unknown> {
  if (addon) {
    const block = addonBlock(addon);
    if (block) throw new AddonUpgradeError(url, addon.manifest.name, block);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(addon ? protocolHeaders(addon.manifest) : {}) },
      ...(fresh ? { cache: 'no-store' as const } : {}),
    });
    if (addon && response.status === 426) {
      // Not asked again until the app's revision changes.
      const note = await readUpgradeNote(response);
      addonRefusals.record(addon.url, note);
      throw new AddonUpgradeError(url, addon.manifest.name, { kind: 'refused', note });
    }
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
  const parsed = readManifest(await getJson(fetcher, null, manifestUrl));
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

/** The `shelf` of a catalog listing the books someone wants to read. */
export const WANT_TO_READ = 'want-to-read';

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
  return validEntries(await getJson(fetcher, ref.addon, url), 'metas', parseWith(MetaPreview));
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

/** The best square cover among pictures: square first, then the largest, at least 300 px. */
export function bestCover(images: ArtworkImage[]): string | null {
  const covers = images.filter((i) => i.kind === 'cover');
  const square = (i: ArtworkImage) =>
    i.width !== undefined && i.height !== undefined
      ? Math.abs(i.width - i.height) / Math.max(i.width, i.height) <= 0.05
      : false;
  const size = (i: ArtworkImage) => Math.min(i.width ?? 0, i.height ?? 0);
  const ranked = [...covers].sort(
    (a, b) =>
      Number(square(b) && size(b) >= 300) - Number(square(a) && size(a) >= 300) ||
      Number(square(b)) - Number(square(a)) ||
      size(b) - size(a),
  );
  return ranked[0]?.url ?? null;
}

/**
 * A cover from the add-ons with an `artwork` resource for this ID, for items that come without
 * one. Add-ons that fail are skipped; null when none has a picture.
 */
export async function fetchArtwork(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
): Promise<string | null> {
  for (const addon of addons) {
    if (!supports(addon.manifest, 'artwork', type, id) || !usableAddon(addon)) continue;
    try {
      const body = await getJson(fetcher, addon, addonBase(addon.url) + artworkPath(type, id));
      const cover = bestCover(validEntries(body, 'artwork', parseWith(ArtworkImage)));
      if (cover) return cover;
    } catch {
      // The next add-on may have one.
    }
  }
  return null;
}

/**
 * A whole series from the first add-on with a `series` resource that knows it (M127). Sends the
 * series' name, its author, the profile's language and, when given, an `ol:` work of the series.
 * Null when every add-on that answered knows none; undefined when none answered, so the caller
 * keeps what it had.
 */
export async function fetchSeriesList(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  want: { name: string; author: string | null; language: string; work?: string | null },
): Promise<SeriesList | null | undefined> {
  const extra: Extra = { language: want.language };
  if (want.author) extra.author = want.author;
  if (want.work) extra.work = want.work;
  let answered = false;
  for (const addon of addons) {
    if (!offersSeries(addon.manifest, 'audiobook') || !usableAddon(addon)) continue;
    try {
      const body = await getJson(
        fetcher,
        addon,
        addonBase(addon.url) + seriesPath('audiobook', want.name, extra),
      );
      const parsed = SeriesResponse.safeParse(body);
      if (!parsed.success) continue;
      answered = true;
      if (parsed.data.series && parsed.data.series.volumes.length > 0) return parsed.data.series;
    } catch {
      // The next add-on may know it.
    }
  }
  return answered ? null : undefined;
}

/** Meta from the first add-on that answers for this ID. */
export async function fetchMeta(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
): Promise<{ addon: InstalledAddon; meta: Meta } | null> {
  let lastError: unknown = null;
  for (const addon of addons.filter(
    (a) => supports(a.manifest, 'meta', type, id) && usableAddon(a),
  )) {
    try {
      const body = await getJson(fetcher, addon, addonBase(addon.url) + metaPath(type, id));
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

/**
 * The valid streams one add-on returns for this ID. A web add-on's stream with `headers` is
 * refused: only an add-on inside the app may ask for headers, since its answers never leave the
 * phone.
 */
export async function fetchAddonStreams(
  fetcher: Fetcher,
  addon: InstalledAddon,
  type: ContentType,
  id: string,
): Promise<FoundStream[]> {
  return (await fetchStreamAnswer(fetcher, addon, type, id)).found;
}

/** One add-on's streams, with its `refreshAfter` in seconds when the answer is incomplete. */
export type StreamAnswer = { found: FoundStream[]; refreshAfter: number | null };

/**
 * One add-on's streams and whether to ask again (M152). `fresh` asks past every cache: the
 * second look a `refreshAfter` asks for.
 */
export async function fetchStreamAnswer(
  fetcher: Fetcher,
  addon: InstalledAddon,
  type: ContentType,
  id: string,
  fresh = false,
): Promise<StreamAnswer> {
  const body = await getJson(fetcher, addon, addonBase(addon.url) + streamPath(type, id), fresh);
  const found = validEntries(
    body,
    'streams',
    parseWith<Stream>(isLocalAddonUrl(addon.url) ? Stream : WebStream),
  ).map((stream) => ({ addon, stream }));
  const after =
    typeof body === 'object' && body !== null
      ? (body as { refreshAfter?: unknown }).refreshAfter
      : undefined;
  const refreshAfter =
    typeof after === 'number' && Number.isInteger(after) && after > 0 && after <= 3600
      ? after
      : null;
  return { found, refreshAfter };
}

/** Streams from every add-on that answers for this ID, in add-on order. */
export async function fetchStreams(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
): Promise<FoundStream[]> {
  const sources = addons.filter((a) => supports(a.manifest, 'stream', type, id) && usableAddon(a));
  const settled = await Promise.allSettled(
    sources.map((addon) => fetchAddonStreams(fetcher, addon, type, id)),
  );
  const found = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (found.length === 0) {
    const failure = settled.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return found;
}
