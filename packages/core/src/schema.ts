import type { Meta, PartTranscript, ScrobbleEvent, SeriesList } from '@lelap/sdk';

import type { EpisodeExtras, PodcastExtras } from './podcasts/podcasting';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Shared tables describe files on this device and are the same for every profile. Every other
// table belongs to a profile, which the schema test enforces.
export const SHARED_TABLES = [
  'library_roots',
  'books',
  'book_files',
  'chapters',
  'profiles',
  'addons',
  'removed_addons',
  'local_addon_code',
  'stream_headers',
  'addon_settings',
  'downloads',
  'podcasts',
  'episodes',
  'sync_state',
  'tombstones',
  'diagnostics',
  'work_links',
  'place_outbox',
  'series_lists',
] as const;

export type StoredChapter = {
  title: string;
  startMs: number;
  /** In the listener's own chapters only (M124): copied from one found from silences, a “Part”. */
  found?: boolean;
};

/**
 * Tags that tell a song from a book (M77), for the “looks like music” suggestions. Fields the
 * reader can't give are null; a file read before M77 has none at all.
 */
export type KindTags = {
  genre: string | null;
  /** From `TSRC`, an `ISRC` comment or the MP4 `----:com.apple.iTunes:ISRC` item. */
  isrc: string | null;
  track: string | null;
  year: string | null;
  /** A narrator tag, or a composer, which audiobooks often use for the narrator. */
  narrator: string | null;
  /** MP4 `stik` (`audiobook`, `music`, `podcast`, `other`), or what a server says the item is. */
  mediaKind: string | null;
  /**
   * The book's series as `Dune #1, Dune Chronicles #1`: from a server (M65), the file's own series
   * tags or an add-on's meta for a streamed book (M109). Absent from files read before M109.
   */
  series?: string | null;
  /** What the book is about, as its server or add-on says (M135). Absent before M135. */
  description?: string | null;
  /** The book's language as its server or add-on says, such as `en` (M135). */
  language?: string | null;
};

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** One of the app's bundled avatars; null shows the name's initial on a colour. */
  avatar: text('avatar'),
  /** SHA-256 of the four-digit PIN with the profile ID. Keeps others out; encrypts nothing. */
  pinHash: text('pin_hash'),
  /** A kids profile cannot change add-ons and sees only the ones a grown-up allows. */
  kids: integer('kids', { mode: 'boolean' }).notNull().default(false),
  /** Add-on manifest URLs this profile does not see. */
  hiddenAddons: text('hidden_addons', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * A WebDAV, SMB or SFTP server, an S3 bucket, a Jellyfin or Audiobookshelf server, or an add-on
 * inside the app that lists a library (M57), used as a library folder. Kept on this device, never
 * synced. Jellyfin keeps a token, not the password; Audiobookshelf an API key.
 */
export type RemoteSource =
  | { type: 'webdav'; url: string; username: string; password: string }
  /** A Windows share or a NAS over SMB 2 or 3 (M62): `smb://host/share/folder`. Android only. */
  | {
      type: 'smb';
      url: string;
      username: string;
      password: string;
      /** The last scan was refused: the login, so Settings asks for it again. */
      refused?: 'login';
    }
  | {
      /** A folder over SSH (M62): `sftp://host:port/folder`. Android only. */
      type: 'sftp';
      url: string;
      username: string;
      /** The server's key as `SHA256:…`, trusted when the server was added; a different one is refused. */
      hostKey: string;
      /** JSON of the password, or the private key and its passphrase; sealed. */
      secret: string;
      /** The last scan was refused: the login, or the server showed another host key. */
      refused?: 'login' | 'host-key';
    }
  | {
      type: 'jellyfin';
      url: string;
      username: string;
      userId: string;
      deviceId: string;
      token: string;
      libraryIds: string[];
      profileId: string;
    }
  | {
      type: 'audiobookshelf';
      url: string;
      username: string;
      userId: string;
      /** An API key, made in Audiobookshelf's settings. */
      token: string;
      /** The server refused the key (expired or turned off); Settings asks for a new one. */
      keyRefused?: boolean;
      libraryIds: string[];
      profileId: string;
    }
  | {
      type: 's3';
      endpoint: string;
      region: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | {
      type: 'addon';
      /** The add-on's `lelap-local://` manifest URL, bundled with the app or installed. */
      addonUrl: string;
      /** Random; names this server's files, `addon-source:<key>/<path>`. */
      key: string;
      /** Shown in Settings, such as `HTTP folder · nas.local:8080`. */
      name: string;
      /** The text and address fields of the add-on's settings form. */
      settings: Record<string, string>;
      /** JSON of the password fields and the headers the library last asked for; sealed. */
      secret: string;
      /**
       * SHA-256 of the installed file the login was entered for; absent for a bundled add-on. A
       * different file under the same ID gets no settings or headers until the login is entered
       * again.
       */
      codeSha?: string;
      /**
       * The profile that added the server, whose places are kept with it when the add-on keeps
       * places (revision 6). Absent before M58: the first profile.
       */
      profileId?: string;
    };

export const libraryRoots = sqliteTable('library_roots', {
  id: text('id').primaryKey(),
  /** Null for a folder on this phone. */
  remote: text('remote', { mode: 'json' }).$type<RemoteSource>(),
  uri: text('uri').notNull(),
  name: text('name').notNull(),
  /** Volume path of the folder, such as `primary:Audiobooks`. */
  location: text('location').notNull(),
  addedAt: integer('added_at').notNull(),
  lastScanAt: integer('last_scan_at'),
  updatedAt: integer('updated_at').notNull(),
});

/** Where a streamed book came from, so the app can find it again from an add-on item. */
export type AddonItemRef = {
  addonUrl: string;
  type: string;
  id: string;
  sourceKey: string;
  /** False when the stream said it may not be downloaded. */
  downloadable?: boolean;
  /**
   * Each part's transcripts by its index, when the stream gave any (revision 12, M136). Kept here
   * rather than on the part's row, so no migration was needed.
   */
  transcripts?: PartTranscript[][];
};

export const books = sqliteTable(
  'books',
  {
    id: text('id').primaryKey(),
    /** Null for books streamed from an add-on. */
    rootId: text('root_id').references(() => libraryRoots.id),
    /**
     * Volume path of the book's folder, or of its file for single-file books; `addon:<type>:<id>`
     * for streamed books.
     */
    location: text('location').notNull().unique(),
    kind: text('kind', { enum: ['folder', 'file'] }).notNull(),
    /** `feed`: a podcast episode from an RSS subscription. */
    source: text('source', { enum: ['local', 'addon', 'feed'] })
      .notNull()
      .default('local'),
    title: text('title').notNull(),
    author: text('author'),
    coverPath: text('cover_path'),
    coverUrl: text('cover_url'),
    addonItem: text('addon_item', { mode: 'json' }).$type<AddonItemRef>(),
    durationMs: integer('duration_ms').notNull(),
    missingSince: integer('missing_since'),
    addedAt: integer('added_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  // The books of one library folder or server, for its scan.
  (t) => [index('books_root_idx').on(t.rootId)],
);

export const bookFiles = sqliteTable(
  'book_files',
  {
    id: text('id').primaryKey(),
    /**
     * Volume path of the file; stable across a change of library folder. For a streamed part,
     * `stream:<sourceKey>:<index>`.
     */
    location: text('location').notNull().unique(),
    /** Null for streamed parts. */
    rootId: text('root_id').references(() => libraryRoots.id),
    bookId: text('book_id').references(() => books.id, { onDelete: 'set null' }),
    idx: integer('idx').notNull(),
    uri: text('uri').notNull(),
    /** Where a server's file downloads from, when not from `uri` (a Subsonic `download` address). */
    downloadUri: text('download_uri'),
    /** An add-on's own note for the file (revision 13), handed back in its place reports. */
    ref: text('ref'),
    relPath: text('rel_path').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    modifiedAt: integer('modified_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    title: text('title'),
    album: text('album'),
    artist: text('artist'),
    albumArtist: text('album_artist'),
    coverPath: text('cover_path'),
    chaptersJson: text('chapters_json', { mode: 'json' }).$type<StoredChapter[]>().notNull(),
    /**
     * ISBNs and ASINs from the file's tags or the server's metadata, normalised (`isbn:978…`).
     * Null for files last read before M56.
     */
    ids: text('ids', { mode: 'json' }).$type<string[]>(),
    /** Genre, ISRC and the like (M77). Null for files last read before M77, or on the web. */
    kindTags: text('kind_tags', { mode: 'json' }).$type<KindTags>(),
    missingSince: integer('missing_since'),
    /** Absolute path of a streamed part's downloaded copy. */
    downloadPath: text('download_path'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('book_files_book_idx').on(t.bookId, t.idx)],
);

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    title: text('title').notNull(),
    /** On the whole-book timeline. */
    startMs: integer('start_ms').notNull(),
    /**
     * Found on this device from long silences (M45), for a book that had no chapters. Never
     * synced: tags, a feed or an add-on replace them whenever they bring chapters of their own.
     */
    found: integer('found', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('chapters_book_idx').on(t.bookId, t.idx)],
);

/**
 * A listener's own chapters for a book (M85), edited by hand, in place of the book's. Kept by the
 * book's synced name, so they survive rescans and reach the listener's other devices. `chapters`
 * null: back to the book's own, kept as a row so the change syncs.
 */
export const ownChapters = sqliteTable(
  'own_chapters',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookKey: text('book_key').notNull(),
    chapters: text('chapters', { mode: 'json' }).$type<StoredChapter[]>(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.bookKey] })],
);

export const libraryEntries = sqliteTable(
  'library_entries',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    speed: real('speed').notNull().default(1),
    /** This book's own sound (M84); null follows the listener's default. Synced like speed. */
    voiceEq: integer('voice_eq', { mode: 'boolean' }),
    skipSilence: integer('skip_silence', { mode: 'boolean' }),
    evenLoudness: integer('even_loudness', { mode: 'boolean' }),
    lastPlayedAt: integer('last_played_at'),
    finishedAt: integer('finished_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.bookId] }),
    // Continue listening on Home and in the Library, without reading every book.
    index('library_entries_played_idx').on(t.profileId, t.lastPlayedAt),
  ],
);

export const progress = sqliteTable(
  'progress',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    fileLocation: text('file_location').notNull(),
    filePositionMs: integer('file_position_ms').notNull(),
    bookPositionMs: integer('book_position_ms').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.bookId] })],
);

export const bookmarks = sqliteTable(
  'bookmarks',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    fileLocation: text('file_location').notNull(),
    filePositionMs: integer('file_position_ms').notNull(),
    bookPositionMs: integer('book_position_ms').notNull(),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('bookmarks_book_idx').on(t.profileId, t.bookId)],
);

export const settings = sqliteTable(
  'settings',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    key: text('key').notNull(),
    /** JSON text. */
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.key] })],
);

/** Installed add-ons, shared by every profile (M9 lets a profile hide some). */
export const addons = sqliteTable('addons', {
  id: text('id').primaryKey(),
  /** The manifest URL; the add-on's base is everything before `manifest.json`. */
  url: text('url').notNull().unique(),
  /** The last manifest fetched, as JSON text. */
  manifest: text('manifest').notNull(),
  position: integer('position').notNull(),
  /** Installed by the app from its configuration rather than by the user. */
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  installedAt: integer('installed_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * The code of add-ons that run inside the app (M38), by their `lelap-local://` manifest URL. Kept
 * on this device; the sandbox loads it from here, never from the network after install.
 */
export const localAddonCode = sqliteTable('local_addon_code', {
  url: text('url').primaryKey(),
  /** Where it was installed from, for updates. */
  sourceUrl: text('source_url').notNull(),
  code: text('code').notNull(),
  /** SHA-256 of `code`, shown at install so a listener can compare it with the author's. */
  sha256: text('sha256').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * The settings of a scrobbler inside the app (M61, protocol revision 8), such as the Open Library
 * reading log's archive.org keys. Every field is sealed with the device's key. On this
 * device only: never synced, exported or in diagnostics.
 */
export const scrobblerSettings = sqliteTable('addon_settings', {
  url: text('url').primaryKey(),
  /** Always `{}`: every field is sealed in `secret`. */
  settings: text('settings').notNull(),
  /** All fields as JSON, sealed; never written where the device can't seal. */
  secret: text('secret').notNull(),
  /** The installed file's fingerprint the settings were entered for; null for a bundled add-on. */
  codeSha: text('code_sha'),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Request headers a stream from an add-on inside the app asked for (M57), such as a login, sealed
 * like a server's password. On this device only: never synced, exported or in diagnostics.
 */
export const streamHeaders = sqliteTable('stream_headers', {
  bookId: text('book_id')
    .primaryKey()
    .references(() => books.id, { onDelete: 'cascade' }),
  /** The add-on that sent them; they go only to its hosts. */
  addonUrl: text('addon_url').notNull(),
  /** JSON of the headers, sealed. */
  headers: text('headers').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Default add-ons the user removed, so they are not installed again. */
export const removedAddons = sqliteTable('removed_addons', {
  url: text('url').primaryKey(),
  removedAt: integer('removed_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Downloads of streamed books. Shared: a downloaded file is stored once for every profile. The
 * native worker reports progress; this row records what was asked for and what finished.
 */
export const downloads = sqliteTable('downloads', {
  bookId: text('book_id')
    .primaryKey()
    .references(() => books.id, { onDelete: 'cascade' }),
  state: text('state', { enum: ['queued', 'done', 'failed'] }).notNull(),
  bytesTotal: integer('bytes_total').notNull(),
  error: text('error'),
  /** The add-on's meta when the download was asked for, so the item page works offline. */
  meta: text('meta', { mode: 'json' }).$type<Meta>(),
  requestedAt: integer('requested_at').notNull(),
  completedAt: integer('completed_at'),
  updatedAt: integer('updated_at').notNull(),
});

/** Podcast feeds the device knows, shared by every profile; subscriptions are per profile. */
export const podcasts = sqliteTable('podcasts', {
  id: text('id').primaryKey(),
  feedUrl: text('feed_url').notNull().unique(),
  /** `podcast:guid` from the feed, when it has one. */
  guid: text('guid'),
  title: text('title').notNull(),
  author: text('author'),
  description: text('description'),
  coverUrl: text('cover_url'),
  link: text('link'),
  /** Podcasting 2.0 people and funding links; null until the feed is read again. */
  extras: text('extras', { mode: 'json' }).$type<PodcastExtras>(),
  /** For conditional requests, so an unchanged feed costs one small response. */
  etag: text('etag'),
  lastModified: text('last_modified'),
  fetchedAt: integer('fetched_at'),
  updatedAt: integer('updated_at').notNull(),
});

export const episodes = sqliteTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    podcastId: text('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    /** The item's `guid`, or its enclosure URL when it has none. */
    guid: text('guid').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    publishedAt: integer('published_at'),
    /** `itunes:season` and `itunes:episode`, for matching files named like `S01E03`. */
    season: integer('season'),
    number: integer('number'),
    durationMs: integer('duration_ms').notNull(),
    url: text('url').notNull(),
    mime: text('mime'),
    size: integer('size').notNull(),
    /** Podcasting 2.0 chapters file, transcripts, people and season name. */
    extras: text('extras', { mode: 'json' }).$type<EpisodeExtras>(),
    /** The library book that plays it, made the first time it is played or downloaded. */
    bookId: text('book_id').references(() => books.id, { onDelete: 'set null' }),
    /**
     * When a feed refresh first stored it on this device, for “new” badges (M105): a feed's
     * date can be older than the refresh that brings it. Null before M105 and from sync.
     */
    addedAt: integer('added_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('episodes_podcast_guid').on(t.podcastId, t.guid),
    index('episodes_podcast_published').on(t.podcastId, t.publishedAt),
    // The episode of a book, which sync and the player look up often.
    index('episodes_book_idx').on(t.bookId),
  ],
);

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    podcastId: text('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    subscribedAt: integer('subscribed_at').notNull(),
    /** Off until the listener turns it on for this podcast. */
    autoDownload: integer('auto_download', { mode: 'boolean' }).notNull().default(false),
    /** How many of the newest unplayed episodes auto-download keeps on the phone. */
    keepLatest: integer('keep_latest').notNull().default(3),
    /** Skipped at the start and the end of every episode of this show (M45); 0 plays it all. */
    skipIntroMs: integer('skip_intro_ms').notNull().default(0),
    skipOutroMs: integer('skip_outro_ms').notNull().default(0),
    /** The show's own sound for every episode (M84); null follows the listener's default. */
    voiceEq: integer('voice_eq', { mode: 'boolean' }),
    skipSilence: integer('skip_silence', { mode: 'boolean' }),
    evenLoudness: integer('even_loudness', { mode: 'boolean' }),
    /**
     * Which of an episode's files to play (M103): null is automatic (the feed's own file, the
     * smallest on mobile data), `smallest`, or an `AudioFile` key such as `alt:Opus`.
     */
    audioChoice: text('audio_choice'),
    /**
     * When this profile last opened the podcast's page on this device: episodes published since
     * are new (M105). Not synced, and it leaves `updatedAt` alone so it never starts a push.
     */
    seenAt: integer('seen_at'),
    /**
     * When counting started here: at subscribing, on arrival by sync, or at the first start
     * with M105. Episodes from before it are never new, so a synced show doesn't light up.
     */
    newSince: integer('new_since'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.podcastId] })],
);

/** The listening queue. Ordered by `position`; a podcast episode that ends plays the next. */
export const upNext = sqliteTable(
  'up_next',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    position: real('position').notNull(),
    addedAt: integer('added_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.bookId] })],
);

/** A listener's tags on a book, as one list so a change syncs as a whole. */
export const bookTags = sqliteTable(
  'book_tags',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.bookId] })],
);

/**
 * Books a listener hid from the library, or said are not music (M77). Keyed on the book's synced
 * name (its location), not its row ID, so it outlives a rescan and syncs like tags.
 */
export const hiddenBooks = sqliteTable(
  'hidden_books',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookKey: text('book_key').notNull(),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    /** The listener said it isn't music, or brought it back: never suggested for hiding again. */
    notMusic: integer('not_music', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.bookKey] })],
);

/** What a smart list shows; every set field must match. */
export type SmartRule = {
  /** The book has every one of these tags. */
  tags?: string[];
  status?: 'notStarted' | 'inProgress' | 'finished';
  kind?: 'book' | 'episode';
  /** Local files and finished downloads only. */
  offline?: boolean;
  /** Length at most this. */
  maxDurationMs?: number;
};

/**
 * Hand-made lists (`rule` null, `items` in order) and smart lists (`rule` set). Items are synced
 * book keys, not row IDs, so a list keeps books that are not on this device yet.
 */
export const playlists = sqliteTable(
  'playlists',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    name: text('name').notNull(),
    rule: text('rule', { mode: 'json' }).$type<SmartRule>(),
    items: text('items', { mode: 'json' }).$type<string[]>().notNull(),
    /** Playing the list goes through finished items too, from their start (M112). */
    keepFinished: integer('keep_finished', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('playlists_profile_idx').on(t.profileId)],
);

/**
 * Time spent listening, per profile, day and book; it stays on this device and is never synced.
 * `day` is the listener's local date (YYYY-MM-DD); `book_id` has no foreign key so the totals
 * outlive a removed book.
 */
export const listeningLog = sqliteTable(
  'listening_log',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    day: text('day').notNull(),
    bookId: text('book_id').notNull(),
    title: text('title').notNull(),
    ms: integer('ms').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.day, t.bookId] })],
);

/**
 * What moved the place in a book (M138): plays, pauses, skips, seeks, chapter jumps and the sleep
 * timer, with where each came from. Kept on this device only and never synced: it is about the
 * last minutes here. The last 50 per book, none older than 30 days (`history.ts`).
 */
export const playbackHistory = sqliteTable(
  'playback_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    source: text('source').notNull(),
    at: integer('at').notNull(),
    fromMs: integer('from_ms').notNull(),
    toMs: integer('to_ms').notNull(),
  },
  (t) => [index('playback_history_book_idx').on(t.profileId, t.bookId, t.at)],
);

/**
 * Scrobble events waiting for an add-on, one row per event and add-on, so offline listening is
 * reported later with its own timestamps. Kept on this device; never synced.
 */
export const scrobbleOutbox = sqliteTable(
  'scrobble_outbox',
  {
    eventId: text('event_id').notNull(),
    /** The add-on's manifest URL. */
    addonUrl: text('addon_url').notNull(),
    profileId: text('profile_id').notNull(),
    /** The protocol's `ScrobbleEvent`. */
    event: text('event', { mode: 'json' }).$type<ScrobbleEvent>().notNull(),
    at: integer('at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.addonUrl] }),
    index('scrobble_outbox_due').on(t.nextAttemptAt),
  ],
);

/**
 * The latest place of a book on a server that keeps places (Jellyfin, Audiobookshelf, an add-on
 * with `place`), still to be sent, so a place reported offline goes out later (M65). Sent for the
 * server's owner profile. Kept on this device; never synced.
 */
export const placeOutbox = sqliteTable(
  'place_outbox',
  {
    rootId: text('root_id').notNull(),
    bookId: text('book_id').notNull(),
    event: text('event', { enum: ['start', 'progress', 'pause', 'finish'] }).notNull(),
    /** On the whole-book timeline. */
    positionMs: integer('position_ms').notNull(),
    at: integer('at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.rootId, t.bookId] }),
    index('place_outbox_due').on(t.nextAttemptAt),
  ],
);

/** This device's sync settings and progress: group, key, device ID, cursor. Never synced. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Deletions to tell other devices about (a bookmark, an Up Next item, a subscription, a streamed
 * book). `key` is the synced identity of what was deleted; `profile_id` is null for shared rows.
 */
export const tombstones = sqliteTable(
  'tombstones',
  {
    kind: text('kind', {
      enum: ['bookmark', 'upNext', 'subscription', 'book', 'profile', 'playlist'],
    }).notNull(),
    key: text('key').notNull(),
    profileId: text('profile_id').notNull().default(''),
    deletedAt: integer('deleted_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key, t.profileId] })],
);

/** What a library book shows instead of its tags once it was matched with a catalog by hand. */
export type LinkedMeta = {
  title: string;
  author: string | null;
  cover: string | null;
  /** The work's series as `Dune #1, Dune Chronicles #1` (M109); absent before M109. */
  series?: string | null;
};

/**
 * A library book and an add-on work it is, or is not (M56). Keyed on the book's location
 * (`webdav:host/path`), which is the same on every device, so it syncs and outlives a rescan.
 * `rejected` remembers a “no” or an unlink, so the page doesn't offer or link it again.
 */
export const workLinks = sqliteTable(
  'work_links',
  {
    bookKey: text('book_key').notNull(),
    workType: text('work_type').notNull(),
    workId: text('work_id').notNull(),
    state: text('state', { enum: ['linked', 'rejected'] }).notNull(),
    /** Every ID the work is known by (its own and `externalIds`), normalised. */
    ids: text('ids', { mode: 'json' }).$type<string[]>().notNull(),
    /** Set by Match with catalog…: the work's title, author and cover. */
    meta: text('meta', { mode: 'json' }).$type<LinkedMeta>(),
    /**
     * The work's series as `Dune #1` (M115), also for a link confirmed with “In your library?”,
     * which keeps the book's own title and so stores no `meta`.
     */
    series: text('series'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bookKey, t.workType, t.workId] }),
    // A work's page looks up its links; every Library list reads the linked titles.
    index('work_links_work_idx').on(t.workType, t.workId),
    index('work_links_state_idx').on(t.state),
  ],
);

/**
 * Whole series as an add-on listed them (M127), by the series' key and the profile's language:
 * the last answer, so a series page works offline. A cache of public data: never synced or
 * backed up.
 */
export const seriesLists = sqliteTable(
  'series_lists',
  {
    key: text('key').notNull(),
    language: text('language').notNull(),
    /** The add-on's answer; null when no add-on knew the series. */
    list: text('list', { mode: 'json' }).$type<SeriesList>(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.language] })],
);

/**
 * The diagnostics log (M47): this device's recent errors and player events, kept only while it
 * is on in Settings. Never synced or backed up; emptied when it is turned off.
 */
export const diagnostics = sqliteTable('diagnostics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  /** A `DiagnosticEvent` as JSON: words from Lelap's code, numbers and row IDs; no free text. */
  event: text('event').notNull(),
});
