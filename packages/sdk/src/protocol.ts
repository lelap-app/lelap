import { z } from 'zod';

/**
 * The protocol's major version; manifests declare it as `protocol`. It changes only for a breaking
 * change, and an app refuses a manifest whose `protocol` it does not know.
 */
export const PROTOCOL_VERSION = 1;

/**
 * The newest revision of protocol 1 this SDK knows; manifests declare it as `protocolVersion`.
 * Revisions only add things, so an older app ignores what it does not know. Absent means 1.
 * 2 adds `behaviorHints` (a `/configure` page, sign-in) and `GET /health`; 3 adds `artwork`; 4
 * adds `badges` on items; 5 adds `settings`, stream `headers` and the `library` resource for
 * add-ons inside the app; 6 adds a library's sealed `query`, a file's `downloadUrl` and `place`, and
 * the `place` resource, for add-ons inside the app; 7 adds `signin` settings and the `signin`
 * resource (a code the listener enters on a website) and a library's `webQuery`, for add-ons inside
 * the app.
 */
export const LATEST_PROTOCOL_VERSION = 7;

export const CONTENT_TYPES = ['audiobook', 'podcast', 'episode'] as const;
export const ContentType = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof ContentType>;

export const RESOURCES = [
  'catalog',
  'meta',
  'stream',
  'scrobble',
  'artwork',
  'library',
  'place',
  'signin',
] as const;
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

// The app sets these itself, so an add-on can't: they would break playback or reach the app's
// own cookies and proxies.
const RESERVED_HEADERS = new Set([
  'host',
  'cookie',
  'content-length',
  'range',
  'connection',
  'transfer-encoding',
  'te',
  'upgrade',
  'proxy-authorization',
  'origin',
  'referer',
  'user-agent',
  'accept-encoding',
]);

/**
 * Since revision 5: request headers the app sends with audio, such as `Authorization`. Only add-ons
 * inside the app may send them, since their answers never leave the phone; the app sends them
 * only to the add-on's own hosts. At most 16, each value visible ASCII.
 */
export const RequestHeaders = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/, 'Not a header name')
      .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), 'The app sets this header'),
    z
      .string()
      .max(4096)
      .regex(/^[\t\x20-\x7e]*$/, 'Header values are visible ASCII'),
  )
  .refine((headers) => Object.keys(headers).length <= 16, 'At most 16 headers');
export type RequestHeaders = z.infer<typeof RequestHeaders>;

/**
 * Since revision 6: query parameters the app adds to the address of every file and download of a
 * library (a folder's `cover.jpg` too), for servers that take a login only there, such as the
 * Subsonic API. Sealed like headers, never stored in a file's address, and added only on the
 * add-on's own hosts. A file's `cover` is shown as it is, without them. At most 16.
 */
export const QueryParams = z
  .record(
    z.string().regex(/^[A-Za-z0-9_.~-]{1,64}$/, 'Not a query parameter name'),
    z
      .string()
      .max(1024)
      .refine(
        (value) => [...value].every((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f),
        'Query values have no control characters',
      ),
  )
  .refine((query) => Object.keys(query).length <= 16, 'At most 16 query parameters');
export type QueryParams = z.infer<typeof QueryParams>;

export const SETTING_TYPES = ['text', 'url', 'password', 'signin'] as const;

/**
 * Since revision 5: one field of the form the app shows when the listener adds an add-on inside
 * the app as a server, such as its address, a user name or a password. The values stay sealed on
 * the phone and reach only that add-on's `library` calls.
 */
export const SettingField = z
  .object({
    /** The key in `settings`: a letter, then letters, digits or `_`. */
    key: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, 'Keys are a letter, then letters, digits or _'),
    label: z.string().min(1).max(80),
    /**
     * `url` is an http or https address; `password` is hidden as it is typed. `signin` (revision 7)
     * is never typed: the app shows a sign-in button, and the add-on's `signin` resource fills the
     * value, which is sealed like a password.
     */
    type: z.enum(SETTING_TYPES),
    /** Fields are optional unless this is true. */
    required: z.boolean().optional(),
    placeholder: z.string().max(200).optional(),
    /** A short line under the field. */
    help: z.string().max(300).optional(),
    /**
     * For `url`: the add-on may reach this address's host for this server, as if it were in
     * `sandbox.hosts`. The listener typed it, so the listener chose it.
     */
    host: z.boolean().optional(),
  })
  .refine((field) => field.host !== true || field.type === 'url', {
    message: 'Only url fields can grant a host',
    path: ['host'],
  });
export type SettingField = z.infer<typeof SettingField>;

const resourceNames = (resources: ResourceDefinition[]) =>
  resources.map((r) => (typeof r === 'string' ? r : r.name));

export const Manifest = z
  .object({
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
    /**
     * Since revision 5, for add-ons inside the app only: the form the app shows when the listener
     * adds the add-on as a server. The values reach its `library` calls as `settings`.
     */
    settings: z.array(SettingField).max(12).optional(),
  })
  .superRefine((manifest, context) => {
    // Settings and libraries are for add-ons on the phone: a web add-on keeps its settings in its
    // address (a configure page), and its answers pass through the network.
    if (!manifest.sandbox && manifest.settings) {
      context.addIssue({
        code: 'custom',
        path: ['settings'],
        message: 'Only add-ons inside the app have settings',
      });
    }
    if (!manifest.sandbox && resourceNames(manifest.resources).includes('library')) {
      context.addIssue({
        code: 'custom',
        path: ['resources'],
        message: 'Only add-ons inside the app list a library',
      });
    }
    if (!manifest.sandbox && resourceNames(manifest.resources).includes('place')) {
      context.addIssue({
        code: 'custom',
        path: ['resources'],
        message: 'Only add-ons inside the app keep places',
      });
    }
    const keys = (manifest.settings ?? []).map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', path: ['settings'], message: 'Setting keys must differ' });
    }
    const signins = (manifest.settings ?? []).filter((f) => f.type === 'signin').length;
    const signs = resourceNames(manifest.resources).includes('signin');
    if (!manifest.sandbox && signs) {
      context.addIssue({
        code: 'custom',
        path: ['resources'],
        message: 'Only add-ons inside the app sign in',
      });
    }
    if (signins > 1 || (signins === 1 && !signs)) {
      context.addIssue({
        code: 'custom',
        path: ['settings'],
        message: 'One signin field at most, with the signin resource',
      });
    }
  });
export type Manifest = z.infer<typeof Manifest>;

/**
 * Since revision 4: what the app may draw on an item's cover, as data. The app draws every badge
 * in one style, adds its own (finished, progress) and lets the listener turn them off, so send
 * plain covers without text baked in. Unknown fields are ignored.
 */
export const Badges = z.object({
  /** The average rating from 0 to 5 stars, such as `4.5`; leave it out when few have rated. */
  rating: z.number().min(0).max(5).optional(),
  /** For a podcast: episodes the add-on counts as new, such as those from the last week. */
  newEpisodes: z.number().int().nonnegative().optional(),
});
export type Badges = z.infer<typeof Badges>;

export const MetaPreview = z.object({
  id: ItemId,
  type: ContentType,
  name: z.string().min(1),
  author: z.string().optional(),
  cover: Url.optional(),
  description: z.string().optional(),
  year: z.number().int().optional(),
  durationMs: Duration.optional(),
  /** Since revision 4. A malformed one is dropped, not the item: badges are only decoration. */
  badges: Badges.optional().catch(undefined),
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
  /**
   * Since revision 5, from add-ons inside the app only: sent with every request for this stream's
   * audio, on the phone, and only to the add-on's own hosts. A web add-on's stream with headers is
   * refused.
   */
  headers: RequestHeaders.optional(),
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

/** A stream as a web add-on may send it: without `headers`. */
export const WebStream = Stream.refine((stream) => stream.headers === undefined, {
  message: 'Only add-ons inside the app may send headers',
  path: ['headers'],
});

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

/** What a web add-on may answer for streams: no stream carries `headers`. */
export const WebStreamResponse = z.object({
  streams: z.array(WebStream),
  cacheMaxAge: CacheMaxAge,
});

// No empty, `.` or `..` segments: the path names a place in the library, never a way out of it.
const LibraryPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) => path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Paths are folders and a file name, separated by /',
  );

/**
 * Since revision 6: where the listener is in one file, as the source keeps it (a server's bookmark).
 * The app takes the newest place of a book, its own or the source's.
 */
export const LibraryPlace = z.object({
  positionMs: Duration,
  /** When the place was saved, as Unix time in milliseconds. */
  at: z.number().int().nonnegative(),
  /** The file was played to its end. */
  played: z.boolean().optional(),
});
export type LibraryPlace = z.infer<typeof LibraryPlace>;

/**
 * Since revision 5: one file of the listener's library, as an add-on inside the app lists it. The
 * app makes books from these as from a folder on the phone: a folder of audio files is a book, an
 * audio file on its own is a book, and `cover.jpg` and friends in a folder are its cover.
 */
export const LibraryFile = z.object({
  /** Folders and the file name with its extension, such as `Frances Hodgson Burnett/The Secret Garden/01.mp3`. */
  path: LibraryPath,
  url: Url,
  size: z.number().int().nonnegative().optional(),
  /** Unix time in milliseconds. A changed size or time makes the app read the file's tags again. */
  modifiedAt: z.number().int().nonnegative().optional(),
  /**
   * The file's length. With it, the app takes the tags below as they are and doesn't read the
   * file; without it, the app reads the tags from the file itself.
   */
  durationMs: Duration.optional(),
  title: z.string().optional(),
  /** The book's title. */
  album: z.string().optional(),
  artist: z.string().optional(),
  /** The book's author. */
  albumArtist: z.string().optional(),
  chapters: z.array(Chapter).optional(),
  /** `isbn:…`, `asin:…` and the like, so the app can link the book to its work. */
  ids: z.array(z.string().min(3).max(128)).max(16).optional(),
  /** A cover for the file's book, when it has none of its own. */
  cover: Url.optional(),
  /**
   * Since revision 6: where the app downloads the file from, when not from `url`, such as a
   * server's download address next to its streaming one. On the add-on's own hosts only.
   */
  downloadUrl: Url.optional(),
  /** Since revision 6: the listener's place in this file as the source keeps it. */
  place: LibraryPlace.optional(),
});
export type LibraryFile = z.infer<typeof LibraryFile>;

/** Since revision 5: `GET /library/audiobook/all.json`, every file of the listener's library. */
export const LibraryResponse = z.object({
  files: z.array(LibraryFile).max(50_000),
  /** Sent with every request for these files on the phone, and only to the add-on's own hosts. */
  headers: RequestHeaders.optional(),
  /** Since revision 6: added to every address of these files, only on the add-on's own hosts. */
  query: QueryParams.optional(),
  /**
   * Since revision 7: added instead of `headers` where the app can't send headers, such as a
   * browser's audio element, so a server that also takes its login in the address plays there.
   * Sealed like `query`, on the add-on's own hosts only.
   */
  webQuery: QueryParams.optional(),
  cacheMaxAge: CacheMaxAge,
});
export type LibraryResponse = z.infer<typeof LibraryResponse>;

const PlaceFile = z.object({ path: LibraryPath, url: Url });

/**
 * Since revision 6, for add-ons with the `place` resource: what the app hands the add-on's `place`
 * handler, next to `settings`, when the listener's place in one of its library's books moves. The
 * app sends one at start and pause, about every five minutes while playing, and at the end.
 */
export const PlaceReport = z.object({
  /** The file the listener is in, as the library listed it (its address without `query`). */
  file: PlaceFile,
  /** Every file of the book, in order, so the add-on can tidy places it kept for the others. */
  files: z.array(PlaceFile).max(5000),
  /** Where the listener is in `file`. */
  positionMs: Duration,
  /** When, as Unix time in milliseconds. */
  at: z.number().int().nonnegative(),
  /** The listener reached the end of the book. */
  finished: z.boolean(),
});
export type PlaceReport = z.infer<typeof PlaceReport>;

/**
 * Since revision 7, for add-ons with the `signin` resource: the answer to `signin/…/start.json`.
 * The app shows `code` and a button that opens `url`, where the listener enters or approves the
 * code, then asks `signin/…/check.json` every `interval` seconds until `expiresAt`.
 */
export const SigninStart = z.object({
  code: z.string().min(1).max(64),
  /** An https page the listener opens, on this device or another. */
  url: Url.refine((value) => value.startsWith('https://'), 'An https address'),
  /** Unix time in milliseconds; the app stops asking then. At most an hour away. */
  expiresAt: z.number().int().nonnegative().optional(),
  /** Seconds between checks, 2 to 30; 5 when absent. */
  interval: z.number().int().min(2).max(30).optional(),
  /** Handed back to each check as `args.signin.state`, such as the sign-in's ID on the website. */
  state: z.string().max(4096).optional(),
});
export type SigninStart = z.infer<typeof SigninStart>;

/**
 * Since revision 7: the answer to `signin/…/check.json`. Without `settings` the listener hasn't
 * finished yet; with them, the app puts these values into the form, by field key, and stops
 * asking. The `signin` field's value is what the add-on keeps, such as a token.
 */
export const SigninResult = z.object({
  settings: z.record(z.string(), z.string().max(4096)).optional(),
});
export type SigninResult = z.infer<typeof SigninResult>;

/**
 * One picture of an item. The app picks the best square cover itself and draws any badges from the
 * item's `badges`.
 */
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

/** Whether the add-on lists a library the app can scan like a server (revision 5). */
export function offersLibrary(manifest: Manifest): boolean {
  return manifest.sandbox !== undefined && resourceNames(manifest.resources).includes('library');
}

/** Whether the add-on keeps the listener's places with its library's source (revision 6). */
export function offersPlaces(manifest: Manifest): boolean {
  return offersLibrary(manifest) && resourceNames(manifest.resources).includes('place');
}

/** The values of an add-on's settings form, by field key. */
export type Settings = Record<string, string>;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Checks what the listener typed into an add-on's settings form. Text and addresses are trimmed,
 * passwords kept as typed, an optional field left empty is `''`, and keys the form doesn't have
 * are dropped. Returns the values or the first problem, in words for the listener.
 */
export function readSettings(
  fields: SettingField[],
  input: Record<string, string | undefined>,
): { settings: Settings } | { error: string } {
  const settings: Settings = {};
  for (const field of fields) {
    const raw = input[field.key] ?? '';
    const sealed = field.type === 'password' || field.type === 'signin';
    const value = sealed ? raw : raw.trim();
    if (value.length > (sealed ? 4096 : 2048)) {
      return { error: `${field.label} is too long.` };
    }
    if (field.required && value === '') {
      return {
        error:
          field.type === 'signin' ? `${field.label}: sign in first.` : `${field.label} is needed.`,
      };
    }
    if (field.type === 'url' && value !== '' && !isHttpUrl(value)) {
      return { error: `${field.label}: an http:// or https:// address, without a login in it.` };
    }
    settings[field.key] = value;
  }
  return { settings };
}

/**
 * The hosts the listener's settings let an add-on reach: those of `url` fields marked `host`,
 * always with their port, such as `192.168.1.20:8080` or `nas.local:443`.
 */
export function settingHosts(fields: SettingField[], settings: Settings): string[] {
  const hosts = new Set<string>();
  for (const field of fields) {
    if (field.type !== 'url' || field.host !== true) continue;
    const value = settings[field.key] ?? '';
    if (!isHttpUrl(value)) continue;
    // Always with the port, so `http://nas.local/` opens port 80 only, not the NAS's admin page.
    const url = new URL(value);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    hosts.add(`${url.hostname.toLowerCase()}:${port}`);
  }
  return [...hosts];
}

/** Whether the add-on signs the listener in through a website (revision 7). */
export function offersSignin(manifest: Manifest): boolean {
  return (
    manifest.sandbox !== undefined &&
    resourceNames(manifest.resources).includes('signin') &&
    (manifest.settings ?? []).some((f) => f.type === 'signin')
  );
}

/**
 * The form's values after a sign-in: those the add-on's `SigninResult` gave, for the form's own
 * fields only. With `sealedOnly`, such as when the listener logs in again to a server already
 * added, only the `signin` and password fields change.
 */
export function applySignin(
  fields: SettingField[],
  current: Settings,
  result: SigninResult,
  sealedOnly = false,
): Settings {
  const next: Settings = { ...current };
  for (const field of fields) {
    const value = result.settings?.[field.key];
    if (value === undefined) continue;
    if (sealedOnly && field.type !== 'signin' && field.type !== 'password') continue;
    next[field.key] = value;
  }
  return next;
}
