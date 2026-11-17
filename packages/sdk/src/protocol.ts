import { z } from 'zod';

/**
 * The protocol's major version; manifests declare it as `protocol`. It changes only for a breaking
 * change, and an app refuses a manifest whose `protocol` it does not know.
 */
export const PROTOCOL_VERSION = 1;

/**
 * The newest revision of protocol 1 this SDK knows; manifests declare it as `protocolVersion`.
 * Revisions only add things, so an older app ignores what it does not know. Absent means 1.
 * 2 adds `behaviorHints` (a `/configure` page, sign-in) and `GET /health`; 3 adds `artwork`.
 */
export const LATEST_PROTOCOL_VERSION = 3;

export const CONTENT_TYPES = ['audiobook', 'podcast', 'episode'] as const;
export const ContentType = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof ContentType>;

export const RESOURCES = ['catalog', 'meta', 'stream', 'scrobble', 'artwork'] as const;
export const ResourceName = z.enum(RESOURCES);
export type ResourceName = z.infer<typeof ResourceName>;

/** `prefix:value`, such as `ol:OL69612W` or `librivox:secret_garden_librivox`. */
export const ItemId = z
  .string()
  .min(3)
  .max(512)
  .regex(/^[a-z][a-z0-9_-]*:.+$/, 'IDs look like prefix:value');

const Url = z.url({ protocol: /^https?$/ });
const Duration = z.number().int().nonnegative();

export const CatalogExtra = z.object({
  /** `search`, `genre` and `skip` are the extras the app understands. */
  name: z.string().min(1),
  isRequired: z.boolean().optional(),
  /** Allowed values, for `genre`. */
  options: z.array(z.string()).optional(),
});
export type CatalogExtra = z.infer<typeof CatalogExtra>;

export const CatalogDefinition = z.object({
  type: ContentType,
  id: z.string().min(1),
  name: z.string().min(1),
  extra: z.array(CatalogExtra).optional(),
  /**
   * What the list means to the listener, so the app can place it. `want-to-read` is a shelf of
   * books they want to read, shown on Home. Unknown values are kept and ignored.
   */
  shelf: z.string().min(1).optional(),
});
export type CatalogDefinition = z.infer<typeof CatalogDefinition>;

export const ResourceDefinition = z.union([
  ResourceName,
  z.object({
    name: ResourceName,
    types: z.array(ContentType).optional(),
    idPrefixes: z.array(z.string().min(1)).optional(),
  }),
]);
export type ResourceDefinition = z.infer<typeof ResourceDefinition>;

export const BehaviorHints = z.object({
  /** The add-on has a `/configure` page next to its manifest. */
  configurable: z.boolean().optional(),
  /**
   * The add-on does nothing useful until it is configured: the app opens `/configure` instead of
   * installing this manifest. The manifest the configure page hands back leaves it out.
   */
  configurationRequired: z.boolean().optional(),
  /** The add-on answers `GET /health`. */
  health: z.boolean().optional(),
});
export type BehaviorHints = z.infer<typeof BehaviorHints>;

export const Manifest = z.object({
  /** Reverse DNS, such as `org.example.myaddon`. */
  id: z.string().min(3),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Use semantic versioning'),
  protocol: z.literal(PROTOCOL_VERSION),
  /** The protocol revision the add-on is written for; absent means 1. */
  protocolVersion: z.number().int().min(1).optional(),
  name: z.string().min(1),
  description: z.string(),
  logo: Url.optional(),
  types: z.array(ContentType).min(1),
  resources: z.array(ResourceDefinition).min(1),
  /** Prefixes of the IDs this add-on answers `meta` and `stream` for. */
  idPrefixes: z.array(z.string().min(1)).optional(),
  catalogs: z.array(CatalogDefinition),
  /** Protocol 1.1 spelling of `behaviorHints.configurable`; still read, so older add-ons work. */
  configurable: z.boolean().optional(),
  /** Since revision 2. Unknown hints are ignored. */
  behaviorHints: BehaviorHints.optional(),
  /**
   * Since revision 3, for add-ons that run inside the app (a single JavaScript file) instead of on
   * a server. `hosts` are the only places the app fetches for it, such as `192.168.1.20:8096` or
   * `*.local`; nothing else is reachable.
   */
  sandbox: z.object({ hosts: z.array(z.string().min(1)).max(32) }).optional(),
});
export type Manifest = z.infer<typeof Manifest>;

export const MetaPreview = z.object({
  id: ItemId,
  type: ContentType,
  name: z.string().min(1),
  author: z.string().optional(),
  cover: Url.optional(),
  description: z.string().optional(),
  year: z.number().int().optional(),
  durationMs: Duration.optional(),
});
export type MetaPreview = z.infer<typeof MetaPreview>;

export const Chapter = z.object({ title: z.string(), startMs: Duration });
export type Chapter = z.infer<typeof Chapter>;

export const Episode = z.object({
  id: ItemId,
  title: z.string(),
  /** ISO 8601. */
  released: z.string().optional(),
  durationMs: Duration.optional(),
  description: z.string().optional(),
});
export type Episode = z.infer<typeof Episode>;

/** A series the work belongs to; `position` is a label such as `1` or `2.5`. */
export const Series = z.object({ name: z.string().min(1), position: z.string().optional() });
export type Series = z.infer<typeof Series>;

export const Meta = MetaPreview.extend({
  narrators: z.array(z.string()).optional(),
  /** Main series first. */
  series: z.array(Series).optional(),
  /** BCP 47 or ISO 639 code. */
  language: z.string().optional(),
  genres: z.array(z.string()).optional(),
  /**
   * On the whole-book timeline. The app uses them for a stream without its own chapters when the
   * stream's length matches `durationMs`.
   */
  chapters: z.array(Chapter).optional(),
  /** The same work under other prefixes, such as `{ ol: 'OL69612W', asin: 'B002UZMLXM' }`. */
  externalIds: z.record(z.string(), z.string()).optional(),
  episodes: z.array(Episode).optional(),
  /** A page about the item on the source's own site. */
  link: Url.optional(),
  /** A podcast's RSS feed. The app subscribes to it and reads it directly. */
  feed: Url.optional(),
});
export type Meta = z.infer<typeof Meta>;

export const StreamPart = z.object({
  url: Url,
  title: z.string().optional(),
  durationMs: Duration,
  size: z.number().int().nonnegative().optional(),
});
export type StreamPart = z.infer<typeof StreamPart>;

const StreamBase = z.object({
  /** Stable for this source and item; the app keys saved places on it. */
  sourceKey: z.string().min(1).max(256),
  /** Who provides it, such as `LibriVox`. */
  name: z.string().min(1),
  /** What makes it different from other streams, such as the reader. */
  title: z.string().optional(),
  mime: z.string().optional(),
  /** Bits per second, such as `64000`. */
  bitrate: z.number().int().positive().optional(),
  size: z.number().int().nonnegative().optional(),
  downloadable: z.boolean().optional(),
});

export const SingleFileStream = StreamBase.extend({
  url: Url,
  durationMs: Duration.optional(),
  chapters: z.array(Chapter).optional(),
});

export const MultiPartStream = StreamBase.extend({
  parts: z.array(StreamPart).min(1),
});

// Parts first: a stream that wrongly sends both `parts` and `url` plays its parts.
export const Stream = z.union([MultiPartStream, SingleFileStream]);
export type Stream = z.infer<typeof Stream>;

const CacheMaxAge = z.number().int().nonnegative().optional();

export const CatalogResponse = z.object({
  metas: z.array(MetaPreview),
  cacheMaxAge: CacheMaxAge,
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;

export const MetaResponse = z.object({ meta: Meta, cacheMaxAge: CacheMaxAge });
export type MetaResponse = z.infer<typeof MetaResponse>;

export const StreamResponse = z.object({
  streams: z.array(Stream),
  cacheMaxAge: CacheMaxAge,
});
export type StreamResponse = z.infer<typeof StreamResponse>;

/** One picture of an item. The app picks the best square cover itself and draws any badges. */
export const ArtworkImage = z.object({
  url: Url,
  /** `cover` is the item's cover; others, such as `banner`, are kept for later and ignored. */
  kind: z.string().min(1).default('cover'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type ArtworkImage = z.infer<typeof ArtworkImage>;

/** Since revision 3: `GET /artwork/{type}/{id}.json`, pictures for an item the add-on knows. */
export const ArtworkResponse = z.object({
  artwork: z.array(ArtworkImage),
  cacheMaxAge: CacheMaxAge,
});
export type ArtworkResponse = z.infer<typeof ArtworkResponse>;

export const SCROBBLE_EVENTS = ['start', 'progress', 'pause', 'finish', 'abandon', 'rate'] as const;
export const ScrobbleEventName = z.enum(SCROBBLE_EVENTS);
export type ScrobbleEventName = z.infer<typeof ScrobbleEventName>;

/** What was played. Never a source, stream or file URL. */
export const ScrobbleItem = z.object({
  type: ContentType,
  /** The item's ID; missing for the listener's own files. */
  id: ItemId.optional(),
  /** The same work under other prefixes, such as `{ isbn: '9780141036144' }`. */
  externalIds: z.record(z.string(), z.string()).optional(),
  name: z.string().min(1),
  author: z.string().optional(),
  durationMs: Duration.optional(),
  /** For episodes: the podcast's RSS feed and the episode's `guid`. */
  podcast: z
    .object({ feed: Url.optional(), guid: z.string().optional(), title: z.string().optional() })
    .optional(),
  episodeGuid: z.string().optional(),
});
export type ScrobbleItem = z.infer<typeof ScrobbleItem>;

export const ScrobbleEvent = z.object({
  /** Unique per event; the same event may be sent again after a failure, so ignore repeats. */
  eventId: z.string().min(8).max(128),
  event: ScrobbleEventName,
  /** When it happened, as Unix time in milliseconds; offline listening arrives later. */
  at: z.number().int().nonnegative(),
  item: ScrobbleItem,
  /** Where the listener was on the whole-item timeline. */
  positionMs: Duration.optional(),
  /** Where this listening session started, for `progress`, `pause` and `finish`. */
  sessionStartMs: Duration.optional(),
  /** For `rate`: 0.5 to 5 stars in steps of 0.5. */
  rating: z.number().min(0.5).max(5).multipleOf(0.5).optional(),
});
export type ScrobbleEvent = z.infer<typeof ScrobbleEvent>;

/** The body of `POST /scrobble`: oldest event first. */
export const ScrobbleRequest = z.object({ events: z.array(ScrobbleEvent).min(1).max(100) });
export type ScrobbleRequest = z.infer<typeof ScrobbleRequest>;

export const HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;
export const HealthStatus = z.enum(HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof HealthStatus>;

/**
 * The body of `GET /health`. `degraded` means it answers but something it relies on is slow or
 * failing; `message` is shown to the listener, so keep it short and free of secrets.
 */
export const HealthResponse = z.object({
  status: HealthStatus,
  message: z.string().max(300).optional(),
  cacheMaxAge: CacheMaxAge,
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** The revision a manifest is written for. */
export function protocolVersionOf(manifest: Manifest): number {
  return manifest.protocolVersion ?? 1;
}

/** Whether the add-on has a `/configure` page, in either spelling. */
export function isConfigurable(manifest: Manifest): boolean {
  return (
    manifest.behaviorHints?.configurable === true ||
    manifest.behaviorHints?.configurationRequired === true ||
    manifest.configurable === true
  );
}

/** Whether the add-on must be configured before it is installed. */
export function needsConfiguration(manifest: Manifest): boolean {
  return manifest.behaviorHints?.configurationRequired === true;
}

/** Whether the add-on answers `GET /health`. */
export function offersHealth(manifest: Manifest): boolean {
  return manifest.behaviorHints?.health === true;
}

/** Whether a stream has parts rather than one URL. */
export function hasParts(stream: Stream): stream is z.infer<typeof MultiPartStream> {
  return 'parts' in stream;
}

/** The `idPrefixes` an add-on declares for a resource, or `null` when it takes any ID. */
export function prefixesFor(manifest: Manifest, resource: ResourceName): string[] | null {
  for (const definition of manifest.resources) {
    if (typeof definition === 'string') {
      if (definition === resource) return manifest.idPrefixes ?? null;
    } else if (definition.name === resource) {
      return definition.idPrefixes ?? manifest.idPrefixes ?? null;
    }
  }
  return [];
}

/**
 * Whether the add-on wants scrobbles for this type. An `idPrefixes` on the `scrobble` entry itself
 * narrows it to those IDs; the manifest's own prefixes are for `meta` and `stream`.
 */
export function wantsScrobble(manifest: Manifest, type: ContentType, id?: string): boolean {
  const definition = manifest.resources.find(
    (r) => (typeof r === 'string' ? r : r.name) === 'scrobble',
  );
  if (!definition) return false;
  if (typeof definition === 'string') return manifest.types.includes(type);
  if (!(definition.types ?? manifest.types).includes(type)) return false;
  const prefixes = definition.idPrefixes;
  return !prefixes || (id !== undefined && prefixes.some((prefix) => id.startsWith(prefix)));
}

/** Whether the add-on answers `resource` for this type and ID. */
export function supports(
  manifest: Manifest,
  resource: ResourceName,
  type: ContentType,
  id: string,
): boolean {
  const definition = manifest.resources.find(
    (r) => (typeof r === 'string' ? r : r.name) === resource,
  );
  if (!definition) return false;
  const types =
    typeof definition === 'string' ? manifest.types : (definition.types ?? manifest.types);
  if (!types.includes(type)) return false;
  const prefixes = prefixesFor(manifest, resource);
  return prefixes === null || prefixes.some((prefix) => id.startsWith(prefix));
}
