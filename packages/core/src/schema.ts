import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Shared tables describe files on this device and are the same for every profile. Every other
// table belongs to a profile, which the schema test enforces.
export const SHARED_TABLES = [
  'library_roots',
  'books',
  'book_files',
  'chapters',
  'profiles',
] as const;

export type StoredChapter = { title: string; startMs: number };

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const libraryRoots = sqliteTable('library_roots', {
  id: text('id').primaryKey(),
  uri: text('uri').notNull(),
  name: text('name').notNull(),
  /** Volume path of the folder, such as `primary:Audiobooks`. */
  location: text('location').notNull(),
  addedAt: integer('added_at').notNull(),
  lastScanAt: integer('last_scan_at'),
  updatedAt: integer('updated_at').notNull(),
});

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  rootId: text('root_id')
    .notNull()
    .references(() => libraryRoots.id),
  /** Volume path of the book's folder, or of its file for single-file books. */
  location: text('location').notNull().unique(),
  kind: text('kind', { enum: ['folder', 'file'] }).notNull(),
  title: text('title').notNull(),
  author: text('author'),
  coverPath: text('cover_path'),
  durationMs: integer('duration_ms').notNull(),
  missingSince: integer('missing_since'),
  addedAt: integer('added_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const bookFiles = sqliteTable(
  'book_files',
  {
    id: text('id').primaryKey(),
    /** Volume path of the file; stable across a change of library folder. */
    location: text('location').notNull().unique(),
    rootId: text('root_id')
      .notNull()
      .references(() => libraryRoots.id),
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
  (t) => [primaryKey({ columns: [t.profileId, t.bookId] })],
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
