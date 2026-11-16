# M2 Local library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play the maintainer's own audiobook folder offline for a week without ever losing the
place, with real Library and Player screens.

**Architecture:** `packages/core` holds the Drizzle schema, migrations and all library logic as
pure, Vitest-tested TypeScript taking a sync Drizzle SQLite database. `modules/library` (new
Kotlin Expo module) picks the folder, lists it and reads tags and chapters. `modules/audio` gains
book identity, a position journal, playback resumption, 30 s skip and smart rewind. `apps/app`
moves to Expo Router and NativeWind and wires the three together.

**Tech Stack:** Expo SDK 58, React Native 0.88, Expo Router, NativeWind 4.2 with Tailwind 3,
expo-sqlite, Drizzle ORM 0.45 and drizzle-kit 0.31, sql.js (tests only), Vitest, Kotlin, Media3
1.11.1.

**Spec:** [`docs/superpowers/specs/2026-11-16-m2-local-library-design.md`](../specs/2026-11-16-m2-local-library-design.md)

**Pull requests (stacked):**

| PR  | Branch         | Base          | Tasks |
| --- | -------------- | ------------- | ----- |
| 1   | `m2/1-core`    | `main`        | 1–7   |
| 2   | `m2/2-native`  | `m2/1-core`   | 8–11  |
| 3   | `m2/3-screens` | `m2/2-native` | 12–16 |

## Global Constraints

- TypeScript strict, no `any`, named exports, comments only for the surprising why (`AGENTS.md`).
- English for UI copy, docs, commits and PRs. No real file names from the maintainer's phone in
  the repository; fixtures use invented names.
- New dependencies must resolve to versions published at least 7 days ago
  (`minimumReleaseAge: 10080`). If `pnpm add` or `npx expo install` stops, choose an older version;
  never add `minimumReleaseAgeExclude` entries or weaken the policy.
- Expo packages through `npx expo install` (SDK 58 compatible ranges).
- `packages/core` imports nothing from React Native or Expo.
- Every user-specific table has `profile_id`; the default profile ID is the constant
  `00000000-0000-7000-8000-000000000001`.
- IDs are text UUIDv7; times are integer milliseconds since the epoch; every table has
  `updated_at`.
- Audio extensions: `mp3 m4a m4b aac ogg oga opus flac wav`.
- Skip interval 30 000 ms; smart rewind 0 ms if paused < 60 s, 5 000 ms if paused ≤ 1 h, 15 000 ms
  beyond; journal write every 10 000 ms while playing.
- CI rules: actions pinned to SHAs, `permissions: contents: read`.
- Before each PR: `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`.

## Review Focus

1. **Folder permission lost or storage unmounted during a scan:** the listing fails; nothing is
   marked missing and no progress changes. Pinned in Task 6 (`applyScan` is never called with a
   failed listing) and Task 13 (orchestration catches and shows the banner).
2. **An older journal entry arriving after newer in-app progress:** the newer one wins. Pinned in
   Task 5.
3. **Files with unknown duration (0):** timeline conversion never returns `NaN` or a negative
   position; positions in such files stay file-relative. Pinned in Task 4.
4. **Danish names and episode codes:** `æ ø å` sort sensibly and `S01E10` sorts after `S01E09`,
   `S02E01` after `S01E10`. Pinned in Task 3.
5. **Resuming deep in a 500 MB mp3:** lands within 2 s of the saved place. Device check in
   Task 16; Task 10 enables mp3 index seeking if needed.

---

## PR 1: core, schema, Vitest, CI (`m2/1-core`)

### Task 1: `@lelap/core` package with Vitest and CI

**Files:**

- Create: `packages/core/package.json`, `packages/core/tsconfig.json`,
  `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/src/ids.ts`,
  `packages/core/src/ids.test.ts`
- Modify: `package.json` (root script `"test": "pnpm -r test"`), `.github/workflows/ci.yml`
  (`- run: pnpm test` after `pnpm check` in `verify`), `AGENTS.md` (repo map line for
  `packages/core`, a `Test | pnpm test` row), `packages/README.md`, `eslint.config.*` if it needs
  the new package's globs

**Interfaces:**

- Produces: `uuidv7(nowMs: number, random: Uint8Array): string` (random has 10 bytes);
  `type IdGenerator = () => string`;
  `createIdGenerator(randomBytes: (n: number) => Uint8Array, clock?: () => number): IdGenerator`.
- `package.json`: `"name": "@lelap/core"`, `"type": "module"`, `"exports": { ".": "./src/index.ts",
"./migrations": "./drizzle/migrations.js" }`, scripts `check: tsc --noEmit`, `test: vitest run`.
  Consumers import TypeScript source directly (Metro and Vitest compile it; no build step).

- [ ] **Step 1: Branch** `git switch -c m2/1-core origin/main`; cherry-pick or keep the design
      doc, plan and roadmap commit.
- [ ] **Step 2: Add Vitest** `pnpm --filter @lelap/core add -D vitest` (after creating
      `package.json`); expect a version ≥ 7 days old.
- [ ] **Step 3: Write failing tests** in `ids.test.ts`:

```ts
it('encodes the timestamp in the first 48 bits', () => {
  const id = uuidv7(0x0190_1234_5678, new Uint8Array(10));
  expect(id.startsWith('01901234-5678-7')).toBe(true);
});
it('sets version 7 and variant 10', () => {
  const id = uuidv7(1, new Uint8Array(10).fill(0xff));
  expect(id[14]).toBe('7');
  expect(['8', '9', 'a', 'b']).toContain(id[19]);
});
it('sorts by time', () => {
  const gen = createIdGenerator(
    (n) => new Uint8Array(n),
    (() => {
      let t = 0;
      return () => ++t;
    })(),
  );
  const [a, b] = [gen(), gen()];
  expect(a < b).toBe(true);
});
```

- [ ] **Step 4:** `pnpm --filter @lelap/core test` → FAIL (module missing).
- [ ] **Step 5: Implement** `ids.ts`.
- [ ] **Step 6:** `pnpm test` → PASS; `pnpm check`, `pnpm lint` pass.
- [ ] **Step 7: Commit** "Add @lelap/core with Vitest and run it in CI".

### Task 2: Schema, migrations and the default profile

**Files:**

- Create: `packages/core/src/schema.ts`, `packages/core/src/profiles.ts`,
  `packages/core/src/db.ts`, `packages/core/drizzle.config.ts`, `packages/core/drizzle/*`
  (generated), `packages/core/test/db.ts`, `packages/core/src/schema.test.ts`

**Interfaces:**

- Produces (schema, Drizzle `sqlite-core`, snake_case columns):
  - shared: `libraryRoots` (`id`, `uri`, `name`, `location`, `addedAt`, `lastScanAt`,
    `updatedAt`); `books` (`id`, `rootId`, `location` unique, `kind: 'folder' | 'file'`, `title`,
    `author`, `coverPath`, `durationMs`, `missingSince`, `addedAt`, `updatedAt`); `bookFiles`
    (`id`, `location` unique, `rootId`, `bookId` nullable, `idx`, `uri`, `relPath`, `name`,
    `size`, `modifiedAt`, `durationMs`, `title`, `album`, `artist`, `albumArtist`, `coverPath`,
    `chaptersJson` text: JSON `{ title: string; startMs: number }[]`, `missingSince`,
    `updatedAt`); `chapters` (`id`, `bookId`, `idx`, `title`, `startMs`, `updatedAt`).
  - per profile: `profiles` (`id`, `name`, `createdAt`, `updatedAt`); `libraryEntries`
    (PK `profileId`+`bookId`, `speed` default 1, `lastPlayedAt`, `finishedAt`, `updatedAt`);
    `progress` (PK `profileId`+`bookId`, `fileLocation`, `filePositionMs`, `bookPositionMs`,
    `updatedAt`); `bookmarks` (`id`, `profileId`, `bookId`, `fileLocation`, `filePositionMs`,
    `bookPositionMs`, `note`, `createdAt`, `updatedAt`); `settings` (PK `profileId`+`key`,
    `value` JSON text, `updatedAt`).
  - `SHARED_TABLES = ['library_roots', 'books', 'book_files', 'chapters', 'profiles'] as const`.
  - `DEFAULT_PROFILE_ID` (Global Constraints value); `currentProfileId(): string` returns it.
  - `type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>`.
  - `test/db.ts`: `createTestDb(): Promise<Db>` (sql.js in memory, runs `drizzle-orm/sql-js/migrator`
    over `drizzle/`).
  - `drizzle/migrations.js` generated with `driver: 'expo'` for the app.
- `bookFiles` is keyed by file, not by book, so regrouping only rewrites `bookId` and `idx`.
- Tag facts live on `bookFiles` so a rescan can regroup without rereading unchanged files.

- [ ] **Step 1:** `pnpm --filter @lelap/core add drizzle-orm` and `add -D drizzle-kit sql.js
@types/sql.js` (versions per Global Constraints).
- [ ] **Step 2: Failing tests** in `schema.test.ts`:

```ts
it('gives every non-shared table a profile_id', async () => {
  const db = await createTestDb();
  const tables = db.all<{ name: string }>(
    sql`select name from sqlite_master where type='table' and name not like '\_\_%' escape '\' and name not like 'sqlite_%'`,
  );
  for (const { name } of tables) {
    if ((SHARED_TABLES as readonly string[]).includes(name)) continue;
    const cols = db.all<{ name: string }>(sql.raw(`pragma table_info(${name})`));
    expect(
      cols.map((c) => c.name),
      name,
    ).toContain('profile_id');
  }
});
it('creates the default profile in the first migration', async () => {
  const db = await createTestDb();
  expect(db.select().from(profiles).all()).toEqual([
    expect.objectContaining({ id: DEFAULT_PROFILE_ID }),
  ]);
});
```

- [ ] **Step 3:** run → FAIL.
- [ ] **Step 4: Implement** schema; `npx drizzle-kit generate`; then
      `npx drizzle-kit generate --custom --name default_profile` and write the
      `insert into profiles …` for `DEFAULT_PROFILE_ID` named “Me”.
- [ ] **Step 5:** run → PASS. Commit "Add the M2 schema with a default profile".

### Task 3: Natural sort and folder grouping

**Files:**

- Create: `packages/core/src/library/files.ts`, `packages/core/src/library/group.ts`, tests beside
  them.

**Interfaces:**

- Produces:
  - `isAudioFile(name: string): boolean`; `compareNatural(a: string, b: string): number`
    (`Intl.Collator('da', { numeric: true, sensitivity: 'base' })`; Hermes ships `Intl`).
  - `type ScannedFile = { location: string; relPath: string; name: string; size: number;
modifiedAt: number; uri: string; durationMs: number; title: string | null; album: string |
null; artist: string | null; albumArtist: string | null; coverPath: string | null; chapters:
{ title: string; startMs: number }[] }` (`relPath` is relative to the root, `/`-separated).
  - `type BookDraft = { location: string; kind: 'folder' | 'file'; title: string; author: string |
null; coverPath: string | null; files: ScannedFile[] }` (files in play order).
  - `groupIntoBooks(rootLocation: string, files: ScannedFile[], folderCovers: Map<string, string>):
BookDraft[]` (`folderCovers` maps a folder's location to a `cover.*`/`folder.*` file's cover
    path, resolved by the scanner).
- Rules exactly as the spec's “Turning a folder into books”, including disc folders matched by
  `/^(cd|disc|disk|part|del)\s*\d+$/i`, and the folder name as title when album tags disagree.
  Author fallback: a parent folder one level above the book that is not the root.

- [ ] **Step 1: Failing tests** (invented names), one `it` each:
  - `S01E10` after `S01E09`, `S02E01` after `S01E10`; `2 < 10`; `Æble < Øl < Ål`.
  - folder with one mp3 → one `folder` book titled from its album tag; with no tags → titled
    with the folder name (`'Author - Title'` kept whole).
  - folder with 62 episode files → one book, files in natural order; album tags `Show` and
    `Show 7` → title is the folder name.
  - folder with three `.m4b` each with chapters → three `file` books; three `.m4b` without
    chapters → one book.
  - `Book/CD 1`, `Book/CD 2` → one book located at `Book`, CD 1 files first.
  - loose file in root → `file` book.
  - `notes.xml`, `position.dat`, `cover.jpg` ignored; folder with only `.nomedia` and `stats.xml`
    → no book; folder with `.nomedia` and an mp3 → a book.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit "Group
      a scanned folder into books".

### Task 4: Chapters and the book timeline

**Files:**

- Create: `packages/core/src/library/chapters.ts`, `packages/core/src/library/timeline.ts`, tests.

**Interfaces:**

- Produces:
  - `buildChapters(files: ScannedFile[]): { title: string; startMs: number }[]` — embedded
    chapters offset by the preceding files' durations; else one per file when there are two or
    more files, titled `title ?? name without extension`, prefixed `S04E01 · ` or `E07 · ` when
    the file name matches `/\bS(\d{1,2})E(\d{1,3})\b/i` or `/\bE(\d{1,3})\b/i` (zero-padded to two
    digits); else `[]`.
  - `type TimelineFile = { location: string; durationMs: number }`.
  - `toBookPosition(files: TimelineFile[], location: string, filePositionMs: number): number`.
  - `toFilePosition(files: TimelineFile[], bookPositionMs: number): { index: number;
location: string; positionMs: number }`.
  - `chapterAt(chapters: { startMs: number }[], bookPositionMs: number): number` (−1 when none).

- [ ] **Step 1: Failing tests:** embedded chapters in file 2 shift by file 1's duration; a
      two-file book without tags gets `S01E01 · Title`; a single file without chapters → `[]`;
      `toBookPosition` of an unknown location → 0; files with `durationMs: 0` never yield `NaN`
      or negatives and `toFilePosition` past the end clamps to the last file's end; `chapterAt` at
      exactly a start returns that chapter.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5:** commit "Build chapters and convert book
      positions".

### Task 5: Progress, journal merge and resume

**Files:**

- Create: `packages/core/src/progress.ts`, `packages/core/src/progress.test.ts`

**Interfaces:**

- Consumes: `Db`, schema, `toBookPosition`, `toFilePosition`.
- Produces:
  - `type JournalEntry = { bookId: string; fileLocation: string; filePositionMs: number;
savedAt: number }` (mirrors Task 10's native journal).
  - `saveProgress(db: Db, profileId: string, entry: JournalEntry): void` — upsert with
    `bookPositionMs` computed from the book's files; writes only when `entry.savedAt` is newer
    than the stored `updatedAt`; also sets `libraryEntries.lastPlayedAt`.
  - `resumePoint(db: Db, profileId: string, bookId: string): { index: number; location: string;
positionMs: number }` — the stored file if it still belongs to the book, else the stored
    `bookPositionMs` mapped through `toFilePosition`, else the start.

- [ ] **Step 1: Failing tests:** save then resume returns the same file and position; an older
      entry after a newer one changes nothing; after the book's files are regrouped so the stored
      file is now index 3, resume follows the file; after the file is removed, resume uses the
      book offset; an unknown book resumes at index 0, position 0.
- [ ] **Step 2–4.** **Step 5:** commit "Save and resume progress per profile".

### Task 6: Scan application

**Files:**

- Create: `packages/core/src/library/scan.ts`, `packages/core/src/library/scan.test.ts`

**Interfaces:**

- Consumes: `groupIntoBooks`, `buildChapters`, schema, `IdGenerator`.
- Produces:
  - `type ListedFile = Omit<ScannedFile, 'durationMs' | 'title' | 'album' | 'artist' |
'albumArtist' | 'coverPath' | 'chapters'>`.
  - `filesNeedingTags(db: Db, rootId: string, listed: ListedFile[]): ListedFile[]` — new files
    and those whose `size` or `modifiedAt` changed; audio files only.
  - `applyScan(db: Db, args: { rootId: string; rootLocation: string; listed: ListedFile[];
tags: Map<string, Omit<ScannedFile, keyof ListedFile>>; folderCovers: Map<string, string>;
now: number; newId: IdGenerator }): { added: number; missing: number }` — one transaction:
    upsert `bookFiles`, regroup, upsert `books` by `location` (keeping IDs), rewrite `chapters`,
    set or clear `missingSince` on files and books, and move `progress` and `bookmarks` whose
    `fileLocation` now belongs to a different book.
  - The caller only calls `applyScan` with a complete, successful listing.

- [ ] **Step 1: Failing tests:** first scan creates books and chapters; a second identical scan
      changes no IDs and `filesNeedingTags` returns `[]`; a touched file is returned by
      `filesNeedingTags`; a removed folder sets `missingSince` and keeps progress and bookmarks; the
      folder returning clears `missingSince`; a regroup from one book into per-file books moves
      progress to the book holding its file; choosing a parent root (`primary:Audiobooks` instead
      of `primary:Audiobooks/Fiction`) keeps book IDs because locations are volume paths.
- [ ] **Step 2–4.** **Step 5:** commit "Apply a folder scan to the library".

### Task 7: Library queries, bookmarks, entries and settings

**Files:**

- Create: `packages/core/src/library/queries.ts`, `packages/core/src/bookmarks.ts`,
  `packages/core/src/settings.ts`, tests; export everything from `src/index.ts`.

**Interfaces:**

- Produces:
  - `listBooks(db, profileId, sort: 'recent' | 'title' | 'author'): LibraryBook[]` where
    `LibraryBook = { id; title; author; coverPath; durationMs; bookPositionMs; finishedAt;
lastPlayedAt; missing: boolean }`; `recent` orders by `lastPlayedAt` desc then `addedAt` desc.
  - `getBook(db, profileId, bookId): { book: LibraryBook; files: (TimelineFile & { uri; title })[];
chapters: { title; startMs }[]; speed: number } | null`.
  - `continueListening(db, profileId): LibraryBook | null` — latest `lastPlayedAt`, not finished,
    not missing.
  - `setSpeed(db, profileId, bookId, speed)`, `setFinished(db, profileId, bookId, finished:
boolean, now)`.
  - `addBookmark(db, profileId, newId, { bookId, fileLocation, filePositionMs, note, now })`,
    `listBookmarks(db, profileId, bookId)` (by `bookPositionMs`), `deleteBookmark(db, profileId,
id)`.
  - `SettingsSchema` (zod): `{ duckOnInterruption: boolean = true; skipIntervalMs: number =
30000; smartRewind: boolean = true }`; `getSettings(db, profileId): Settings`;
    `setSetting<K>(db, profileId, key: K, value: Settings[K], now)`.
- `pnpm --filter @lelap/core add zod` (version ≥ 7 days old).

- [ ] **Step 1: Failing tests:** sorts; `continueListening` skips finished and missing; bookmark
      round trip ordered by position; settings default when empty and survive a write; profile
      isolation — another profile's progress and bookmarks never appear.
- [ ] **Step 2–4.** **Step 5:** commit "Add library queries, bookmarks and settings".
- [ ] **Step 6: PR 1.** Run the five checks, push `m2/1-core`, open the PR against `main`.

## PR 2: native modules (`m2/2-native`, based on `m2/1-core`)

### Task 8: `@lelap/library` module: folder picker and listing

**Files:**

- Create: `modules/library/package.json`, `expo-module.config.json`, `tsconfig.json`,
  `README.md`, `src/index.ts`, `android/build.gradle`,
  `android/src/main/java/app/lelap/library/LibraryModule.kt`,
  `android/src/main/java/app/lelap/library/TreeLister.kt`
- Modify: `apps/app/package.json` (`"@lelap/library": "workspace:*"`), `.github/workflows/ci.yml`
  (`./gradlew :lelap-audio:testDebugUnitTest :lelap-library:testDebugUnitTest`), `AGENTS.md`
  repo map.

**Interfaces:**

- Produces (JS):
  - `pickFolder(): Promise<{ uri: string; name: string; location: string } | null>` —
    `ACTION_OPEN_DOCUMENT_TREE` through Expo's activity-result API,
    `takePersistableUriPermission(FLAG_GRANT_READ_URI_PERMISSION)`; `location` is the tree's
    document ID (`primary:Audiobooks`).
  - `hasPermission(uri: string): Promise<boolean>` — present in `persistedUriPermissions`.
  - `listTree(uri: string): Promise<ListedFile[]>` — recursive `DocumentsContract` children
    queries; rejects with `ERR_LELAP_PERMISSION` when access is gone; `location` is the
    document ID, `relPath` relative to the tree root.
- `ListedFile` is imported as a type from `@lelap/core`.

- [ ] **Step 1:** scaffold the module like `modules/audio` (Gradle project name `lelap-library`).
- [ ] **Step 2:** implement the three functions.
- [ ] **Step 3:** prebuild and run on the phone with a scratch button; pick `Audiobooks`; the
      listing has 121 entries, and revoking access in system settings makes `listTree` reject.
- [ ] **Step 4:** commit "Add the library module with folder picking and listing".

### Task 9: Tags, covers and chapter parsers

**Files:**

- Create: `modules/library/android/src/main/java/app/lelap/library/TagReader.kt`,
  `Id3Chapters.kt`, `Mp4Chapters.kt`, tests in `android/src/test/java/app/lelap/library/`
  with small fixture byte arrays built in the test.

**Interfaces:**

- Produces (JS): `readTags(uri: string, coverDir: string): Promise<{ durationMs; title; album;
artist; albumArtist; coverPath; chapters: { title: string; startMs: number }[] }>` —
  `MediaMetadataRetriever` for text tags, duration and embedded picture (saved as
  `coverDir/<sha1 of location>.jpg`, longest side ≤ 600 px); chapters from the first bytes of the
  file.
- `Id3Chapters.parse(header: ByteArray): List<Chapter>` — ID3v2.3/2.4 `CHAP` frames with `TIT2`
  sub-frames, ordered by start (follows `CTOC` when present).
- `Mp4Chapters.parse(read: (offset: Long, length: Int) -> ByteArray, size: Long): List<Chapter>` —
  Nero `chpl` in `moov/udta`; QuickTime chapter text track when there is no `chpl`.
- `readFolderCover(uri: string, coverDir: string): Promise<string | null>` for `cover.*`/`folder.*`.

- [ ] **Step 1: Failing JVM tests:** ID3v2.4 with two `CHAP` frames → two chapters with titles
      and starts; v2.3 sizes (non-synchsafe) parse too; no `CHAP` → empty; `chpl` with three
      entries (100 ns units) → ms starts; truncated input → empty, never throws.
- [ ] **Step 2:** `cd apps/app/android && ./gradlew :lelap-library:testDebugUnitTest` → FAIL.
- [ ] **Step 3–4:** implement; PASS.
- [ ] **Step 5:** on the phone, `readTags` on a book file returns album, artist and duration ≈
      file length, and a cover path for the episode files.
- [ ] **Step 6:** commit "Read tags, covers and chapters".

### Task 10: Audio: book loading, journal, resumption

**Files:**

- Create: `modules/audio/android/src/main/java/app/lelap/audio/PositionJournal.kt`,
  `modules/audio/android/src/test/java/app/lelap/audio/PositionJournalTest.kt`
- Modify: `AudioModule.kt`, `PlaybackService.kt`, `Commands.kt`, `modules/audio/src/index.ts`,
  `modules/audio/android/build.gradle` (`testImplementation 'org.json:json:…'`)

**Interfaces:**

- Produces (JS, replacing `load(bookTitle, parts, startIndex)`):
  - `type BookLoad = { bookId: string; title: string; author: string | null; coverUri: string |
null; files: { uri: string; location: string; title: string; durationMs: number }[];
chapters: { title: string; startMs: number }[]; startIndex: number; startPositionMs: number;
speed: number }`; `load(book: BookLoad, autoplay: boolean): Promise<void>`.
  - `seekTo(index: number, positionMs: number): Promise<void>`.
  - `takeJournal(): Promise<JournalEntry | null>` (returns the last entry; does not clear it).
  - `PlayerState` adds `bookId: string | null` and `fileLocation: string | null`.
- `PositionJournal` (pure): `encode(entry, playlist): String`, `decode(String): Pair<Entry,
Playlist>?`, `shouldWrite(lastWriteAt: Long, now: Long, event: Event): Boolean` where `Event` is
  `TICK | PAUSE | ITEM_CHANGE | SEEK | TASK_REMOVED | DESTROY` (ticks every 10 000 ms, others
  always).
- The service writes the journal to its own SharedPreferences file (`lelap_journal`, `commit()`
  on `TASK_REMOVED` and `DESTROY`, `apply()` otherwise) and implements
  `MediaSession.Callback.onPlaybackResumption` from it, restoring playlist, index, position and
  speed.
- If Task 16's device check shows VBR drift, construct the extractor factory with
  `Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING`.

- [ ] **Step 1: Failing JVM tests:** encode/decode round trip incl. Danish titles; corrupt JSON →
      `null`; `shouldWrite` true at 10 000 ms, false at 9 999, always true for `PAUSE`.
- [ ] **Step 2–4:** FAIL, implement, PASS (`:lelap-audio:testDebugUnitTest`).
- [ ] **Step 5:** commit "Load whole books and keep a position journal".

### Task 11: Audio: 30 s skip, smart rewind, chapter titles, settings

**Files:**

- Modify: `PlaybackRules.kt` and its test, `PlaybackService.kt`, `AudioModule.kt`,
  `Commands.kt`, `modules/audio/src/index.ts`, `modules/audio/README.md`

**Interfaces:**

- Produces (JS): `setSettings(s: { duckOnInterruption: boolean; skipIntervalMs: number;
smartRewind: boolean }): Promise<void>` (replaces `setDuckOnInterruption`; stored in the
  service's prefs). `PlayerState.chapterTitle: string | null`.
- `PlaybackRules.rewindOnResume(pausedForMs: Long): Long` — values from Global Constraints;
  applied on any play request (app, notification, headphones) when `smartRewind` is on, never
  before position 0 and never across a file start.
- Previous/next from any controller seek by `skipIntervalMs` (a `ForwardingPlayer` overriding
  `seekToPrevious`/`seekToNext` and their media-item variants; seek increments set to the same
  value).
- On crossing a chapter boundary the service updates the current item's `MediaMetadata.title` to
  the chapter title with `replaceMediaItem` (same URI, so playback does not rebuffer).

- [ ] **Step 1: Failing JVM tests:** `rewindOnResume(59_999) == 0`, `(60_000) == 5_000`,
      `(3_600_000) == 5_000`, `(3_600_001) == 15_000`.
- [ ] **Step 2–4.** **Step 5:** on the phone: lock-screen ⏮/⏭ move 30 s; a 2-minute pause
      rewinds 5 s; the notification title follows chapters of a chaptered test file.
- [ ] **Step 6:** commit "Skip by 30 seconds, rewind after pauses, show chapter titles".
- [ ] **Step 7: PR 2.** Checks, push `m2/2-native`, PR with base `m2/1-core`.

## PR 3: screens (`m2/3-screens`, based on `m2/2-native`)

### Task 12: Expo Router, NativeWind and the database in the app

**Files:**

- Create: `apps/app/app/_layout.tsx`, `apps/app/app/dev/spike.tsx` (the M1 screen, moved),
  `apps/app/src/dev/librivox.ts` (moved), `apps/app/babel.config.js`, `apps/app/metro.config.js`,
  `apps/app/tailwind.config.js`, `apps/app/global.css`, `apps/app/nativewind-env.d.ts`,
  `apps/app/src/db.ts`
- Modify: `apps/app/package.json` (`"main": "expo-router/entry"`, deps), `apps/app/app.json`
  (plugins `expo-router`, `expo-sqlite`), `apps/app/tsconfig.json`
- Delete: `apps/app/App.tsx`, `apps/app/index.ts`, `apps/app/src/PlayerScreen.tsx`,
  `apps/app/src/librivox.ts`

**Interfaces:**

- Produces: `openDb(): Db` (expo-sqlite `openDatabaseSync('lelap.db')`, `PRAGMA journal_mode=WAL`,
  `drizzle(…, { schema })`); `useDbReady(): { ready: boolean; error: Error | null }`
  (runs `useMigrations` with `@lelap/core/migrations`); `newId` from `createIdGenerator` with
  `expo-crypto` `getRandomBytes`.
- Theme tokens in `tailwind.config.js`: `night: '#0d0e11'`, `paper: '#f4f1ea'`, `muted:
'#8d8a83'`, `line: '#33353b'`, `amber: '#f5b041'`, `danger: '#ff8a7a'`.
- Deps via `npx expo install expo-router react-native-safe-area-context react-native-screens
expo-linking expo-constants expo-sqlite expo-crypto react-native-reanimated react-native-worklets`
  and `pnpm add nativewind@4.2.7 drizzle-orm zod @lelap/core@workspace:*`,
  `pnpm add -D tailwindcss@^3.4 babel-plugin-inline-import`. Metro: `sourceExts` gains `sql`;
  Babel: `inline-import` for `.sql`. Approve new build scripts with `pnpm approve-builds` only if
  install asks.

- [ ] **Step 1:** install, configure, move the spike screen to `/dev/spike`.
- [ ] **Step 2:** `pnpm check`, `pnpm lint`, `pnpm android`: the app opens, migrations run (a
      placeholder index route shows the profile name “Me” from the database), and `/dev/spike`
      still plays LibriVox 254 (needed for the remaining M1 call checks).
- [ ] **Step 3:** commit "Move the app to Expo Router, NativeWind and SQLite".

### Task 13: Scanning and the Library screen

**Files:**

- Create: `apps/app/src/platform/library.ts`, `apps/app/src/scan.ts`, `apps/app/app/index.tsx`,
  `apps/app/src/components/BookRow.tsx`, `apps/app/src/components/ContinueCard.tsx`,
  `apps/app/src/components/MiniPlayer.tsx`, `apps/app/src/useLibrary.ts`

**Interfaces:**

- Consumes: Task 6–8 APIs.
- Produces: `scanLibrary(db, onProgress: (done: number, total: number) => void): Promise<
{ added: number; missing: number } | { error: 'permission' }>` — `listTree`, then
  `filesNeedingTags`, `readTags` one by one (reporting progress), folder covers, then
  `applyScan`. On `ERR_LELAP_PERMISSION` returns `{ error: 'permission' }` without touching the
  database. Runs at startup and on pull to refresh; a second call while one runs returns the
  running promise.
- Screen per the spec sketch: empty state button “Choose your audiobooks folder”; permission
  banner “Lelap can no longer read your audiobooks folder.” with “Choose folder”; “Scanning… 12 of
  40”; Continue card; sort menu Recent/Title/Author; rows with progress %, “New”, “✓ Finished”,
  dimmed “Files not found”; long press toggles finished; mini player on every screen except the
  Player.

- [ ] **Step 1:** implement; **Step 2:** on the phone pick `Audiobooks`: six books appear (four
      books, two series), covers on the series, second launch reads no tags (log count).
- [ ] **Step 3:** commit "Scan the library folder and show the Library".

### Task 14: Player screen with progress saving

**Files:**

- Create: `apps/app/app/player.tsx`, `apps/app/src/platform/audio.ts`, `apps/app/src/usePlayer.ts`,
  `apps/app/src/bootstrap.ts`

**Interfaces:**

- Produces:
  - `bootstrap(db)` (called from `_layout` once ready): `takeJournal` → `saveProgress`; push
    `getSettings` to `setSettings`; load `continueListening` paused at `resumePoint` unless the
    service already has a book.
  - `playBook(db, bookId, autoplay = true)`: `getBook` + `resumePoint` → `load`.
  - `usePlayer()` → `PlayerState`; saves progress from state events at most every 10 000 ms and
    immediately on pause, and on app background (`AppState`) via `takeJournal`.
- Screen per the spec sketch: scrubber over the current chapter, or the whole book when it has
  no chapters; ⟲30 / ⏮ Ch. / ▶ / Ch. ⏭ / 30⟳ (chapter buttons hidden without chapters); speed
  sheet `0.8 1 1.1 1.25 1.5 1.75 2 2.5 3`, saved with `setSpeed`; sleep timer 5, 15, 30, 45 and 60 min
  (no end-of-chapter option in M2); “3 h 12 min left in book”.

- [ ] **Step 1:** implement; **Step 2:** on the phone: play a book, pause, swipe the app away,
      reopen → same place; change speed, reopen the book → same speed.
- [ ] **Step 3:** commit "Add the Player and save the place".

### Task 15: Chapters, bookmarks and settings

**Files:**

- Create: `apps/app/src/components/ChaptersSheet.tsx`, `apps/app/src/components/BookmarksSheet.tsx`,
  `apps/app/app/settings.tsx`

**Interfaces:**

- Bookmarks: “+ Bookmark” saves the current place immediately, then offers an optional note;
  the sheet lists `listBookmarks` with time and note; tap jumps (`seekTo` via `toFilePosition`);
  swipe or long press deletes.
- Chapters sheet: current chapter highlighted; tap jumps.
- Settings: library folder name with “Change folder” and “Rescan”; “Duck on calls” switch; skip
  interval 10/15/30/45/60 s; smart rewind switch; each writes `setSetting` then `setSettings`.

- [ ] **Step 1:** implement; **Step 2:** on the phone: Bandeland shows 62 episodes as chapters
      titled with `S01E01 · …`; a bookmark survives an app restart; changing skip interval changes
      the lock-screen skip.
- [ ] **Step 3:** commit "Add chapters, bookmarks and settings".

### Task 16: Device checklist and the week test

**Files:**

- Modify: `apps/app/README.md` (M2 device checklist), `modules/audio/README.md` (M1 checklist
  now uses `/dev/spike`), `docs/roadmap.md`

- [ ] **Step 1:** write the checklist: resume deep inside a 500 MB mp3 within 2 s of the saved
      place (play 2 h in, note time, kill, reopen); swipe away mid-chapter; reboot; Bluetooth Play
      with the app closed resumes; airplane mode throughout; rename a book folder → dimmed, rename
      back → whole with its place; revoke folder permission → banner, nothing marked missing.
- [ ] **Step 2:** run it on the Pixel; record results. Fix VBR drift with Task 10's flag if
      needed.
- [ ] **Step 3:** commit "Add the M2 device checklist"; **Step 4: PR 3** with base
      `m2/2-native`.
- [ ] **Step 5:** after a week of daily listening in airplane mode without losing the place, set
      M2 to Done in `docs/roadmap.md` (separate small PR).
