import { z } from 'zod';

/** The protocol version this SDK speaks; manifests declare it as `protocol`. */
export const PROTOCOL_VERSION = 1;

export const CONTENT_TYPES = ['audiobook', 'podcast', 'episode'] as const;
export const ContentType = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof ContentType>;

export const RESOURCES = ['catalog', 'meta', 'stream'] as const;
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

export const Manifest = z.object({
  /** Reverse DNS, such as `org.example.myaddon`. */
  id: z.string().min(3),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Use semantic versioning'),
  protocol: z.literal(PROTOCOL_VERSION),
  name: z.string().min(1),
  description: z.string(),
  logo: Url.optional(),
  types: z.array(ContentType).min(1),
  resources: z.array(ResourceDefinition).min(1),
  /** Prefixes of the IDs this add-on answers `meta` and `stream` for. */
  idPrefixes: z.array(z.string().min(1)).optional(),
  catalogs: z.array(CatalogDefinition),
  /** The add-on has a `/configure` page. */
  configurable: z.boolean().optional(),
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

export const Meta = MetaPreview.extend({
  narrators: z.array(z.string()).optional(),
  /** BCP 47 or ISO 639 code. */
  language: z.string().optional(),
  genres: z.array(z.string()).optional(),
  chapters: z.array(Chapter).optional(),
  /** The same work under other prefixes, such as `{ ol: 'OL69612W' }`. */
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
