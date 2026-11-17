import type { Meta, ScrobbleEvent } from '@lelap/sdk';

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
  'downloads',
  'podcasts',
  'episodes',
  'sync_state',
  'tombstones',
] as const;

export type StoredChapter = { title: string; startMs: number };

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
 * A WebDAV server, an S3 bucket, or a Jellyfin or Audiobookshelf server used as a library folder.
 * Kept on this device, never synced. Jellyfin keeps a token, not the password; Audiobookshelf an API key.
 */
export type RemoteSource =
  | { type: 'webdav'; url: string; username: string; password: string }
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
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('chapters_book_idx').on(t.bookId, t.idx)],
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
