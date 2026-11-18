import type { ContentType } from '@lelap/sdk';
import { and, eq, like } from 'drizzle-orm';

import type { Db } from '../db';
import { bookIndex, findBook } from '../importers/match';
import type { LibraryBook } from '../library/queries';
import { settings } from '../schema';
import { type Fetcher, fetchMeta, type InstalledAddon } from './client';
import { findSources, type Sources, sourceRequests, workIds } from './sources';
import { findStreamedBook } from './streamed';

/**
 * Where a catalog item can be heard from, for the badge on its cover. `local` is a file or a
 * finished download on this device; `stream` names the first add-on that has a stream for it;
 * `none` means every add-on that could have one answered without.
 */
export type Availability = { kind: 'local' } | { kind: 'stream'; addon: string } | { kind: 'none' };

/** A catalog item, as far as its badge needs it. */
export type WorkRef = { type: ContentType; id: string; name: string; author?: string };

export const workKey = (work: { type: string; id: string }) => `${work.type}\n${work.id}`;

/**
 * Finds items already on this device: a streamed book whose download finished, or a book from a
 * library folder with the same title and author. Reads the library once, on the first lookup;
 * make a new one when the library changes.
 */
export function localLookup(db: Db, profileId: string): (work: WorkRef) => boolean {
  let index: Map<string, LibraryBook[]> | null = null;
  let downloaded: Set<string> | null = null;
  const load = () => {
    // A book the listener hid is not one they have: wanted books ask the add-ons instead.
    index ??= bookIndex(db, profileId, 'visible');
    downloaded ??= new Set([...index.values()].flat().flatMap((b) => (b.downloaded ? [b.id] : [])));
    return { index, downloaded };
  };
  // Screens ask again on every render; remember the answers.
  const answers = new Map<string, boolean>();
  const lookup = (work: WorkRef) => {
    const { index, downloaded } = load();
    const streamed = findStreamedBook(db, work.type, work.id);
    if (streamed !== null && downloaded.has(streamed)) return true;
    if (work.type !== 'audiobook') return false;
    return findBook(index, work.name, work.author ? [work.author] : [])?.source === 'local';
  };
  return (work) => {
    const key = workKey(work);
    let answer = answers.get(key);
    if (answer === undefined) answers.set(key, (answer = lookup(work)));
    return answer;
  };
}

const verdict = (sources: Sources): Availability | null => {
  const first = sources.found[0];
  if (first) return { kind: 'stream', addon: first.addon.manifest.name };
  // An add-on that did not answer might have had one: no verdict yet.
  return sources.failed.length > 0 ? null : { kind: 'none' };
};

/**
 * Whether any add-on streams this work, or null when it can't tell. When none has it by the
 * catalog's ID, the work's meta is read for its external IDs (a reading tracker's `hardcover:`
 * book is known to LibriVox by its `ol:` ID), and those are asked too.
 */
export async function streamAvailability(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
): Promise<Availability | null> {
  try {
    const first = verdict(await findSources(fetcher, addons, type, id));
    if (first?.kind !== 'none') return first;
    const meta = await fetchMeta(fetcher, addons, type, id);
    const externalIds = meta?.meta.externalIds;
    const before = sourceRequests(addons, type, [id]);
    const after = sourceRequests(addons, type, workIds(id, externalIds));
    const changed = after.some((r, i) => r.id !== before[i]?.id) || after.length !== before.length;
    if (!changed) return first;
    return verdict(await findSources(fetcher, addons, type, id, externalIds));
  } catch {
    return null;
  }
}

export type SourceCacheOptions = {
  /** How long a found stream is trusted. */
  foundTtlMs?: number;
  /** How long "no source" is trusted; shorter, since add-ons gain books. */
  noneTtlMs?: number;
  /** Requests in flight at once. */
  concurrency?: number;
  /** Pause between two requests starting, so a fast scroll never becomes a storm. */
  spacingMs?: number;
  /** Waiting items kept; older ones are dropped, as they have scrolled out of sight. */
  maxPending?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

type Entry = { value: Availability; at: number };
type Ask = (work: WorkRef) => Promise<Availability | null>;

/**
 * Remembers per work which add-ons answered `stream`, and asks lazily: callers name the items on
 * screen, the cache asks for the newest first, a few at a time, and tells subscribers on change.
 */
export class SourceCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, WorkRef>();
  private readonly inFlight = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly options: Required<SourceCacheOptions>;
  private running = 0;
  private lastStart = -Infinity;
  private generation = 0;

  constructor(
    private ask: Ask,
    options: SourceCacheOptions = {},
  ) {
    this.options = {
      foundTtlMs: 24 * 60 * 60_000,
      noneTtlMs: 6 * 60 * 60_000,
      concurrency: 2,
      spacingMs: 250,
      maxPending: 40,
      now: () => Date.now(),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...options,
    };
  }

  /** A fresh answer for this work, if there is one. */
  get(work: { type: string; id: string }): Availability | undefined {
    const entry = this.entries.get(workKey(work));
    if (!entry) return undefined;
    const ttl = entry.value.kind === 'none' ? this.options.noneTtlMs : this.options.foundTtlMs;
    return this.options.now() - entry.at < ttl ? entry.value : undefined;
  }

  /** Stores an answer found elsewhere, such as on the item page. */
  set(work: { type: string; id: string }, value: Availability): void {
    this.entries.set(workKey(work), { value, at: this.options.now() });
    this.emit();
  }

  /** Asks for these works unless known; the newest asks go first. */
  request(works: WorkRef[]): void {
    for (const work of works) {
      const key = workKey(work);
      if (this.get(work) !== undefined || this.inFlight.has(key)) continue;
      // Re-inserting moves the work to the end, which is asked first.
      this.pending.delete(key);
      this.pending.set(key, work);
    }
    while (this.pending.size > this.options.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    this.pump();
  }

  /** Forgets every answer, for example when the installed add-ons change. */
  clear(): void {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
    this.emit();
  }

  /** Swaps the function that asks, for new add-ons, and forgets what the old ones said. */
  reset(ask: Ask): void {
    this.ask = ask;
    this.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private next(): WorkRef | undefined {
    const keys = [...this.pending.keys()];
    const key = keys[keys.length - 1];
    if (key === undefined) return undefined;
    const work = this.pending.get(key);
    this.pending.delete(key);
    return work;
  }

  private pump() {
    while (this.running < this.options.concurrency && this.pending.size > 0) {
      const work = this.next();
      if (!work) return;
      void this.run(work);
    }
  }

  private async run(work: WorkRef) {
    const key = workKey(work);
    const generation = this.generation;
    this.running++;
    this.inFlight.add(key);
    try {
      const gap = this.lastStart + this.options.spacingMs - this.options.now();
      this.lastStart = Math.max(this.options.now(), this.lastStart + this.options.spacingMs);
      if (gap > 0) await this.options.wait(gap);
      const value = await this.ask(work);
      if (value && generation === this.generation) {
        this.entries.set(key, { value, at: this.options.now() });
        this.emit();
      }
    } finally {
      this.inFlight.delete(key);
      this.running--;
      this.pump();
    }
  }
}

// Wanted works live in the settings table under keys `getSettings` ignores and sync never
// sends, like the source choice, so they need no migration.
const WANTED_PREFIX = 'wanted:';
const wantedKey = (type: string, id: string) => `${WANTED_PREFIX}${type}:${id}`;

export type WantedWork = WorkRef & {
  /** Whether a source was known at the last check; only a change to true is news. */
  playable: boolean;
  addedAt: number;
  checkedAt: number | null;
};

function parseWanted(value: string): WantedWork | null {
  try {
    const v = JSON.parse(value) as Partial<WantedWork>;
    if (typeof v.type !== 'string' || typeof v.id !== 'string' || typeof v.name !== 'string')
      return null;
    return {
      type: v.type,
      id: v.id,
      name: v.name,
      ...(typeof v.author === 'string' ? { author: v.author } : {}),
      playable: v.playable === true,
      addedAt: typeof v.addedAt === 'number' ? v.addedAt : 0,
      checkedAt: typeof v.checkedAt === 'number' ? v.checkedAt : null,
    };
  } catch {
    return null;
  }
}

function writeWanted(db: Db, profileId: string, work: WantedWork, now: number) {
  const value = JSON.stringify(work);
  db.insert(settings)
    .values({ profileId, key: wantedKey(work.type, work.id), value, updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: now },
    })
    .run();
}

/** Every work this profile wants to read, oldest first. */
export function listWanted(db: Db, profileId: string): WantedWork[] {
  return db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.profileId, profileId), like(settings.key, `${WANTED_PREFIX}%`)))
    .all()
    .flatMap((row) => {
      const work = parseWanted(row.value);
      return work ? [work] : [];
    })
    .sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * Makes the wanted list match the want-to-read shelves: new works are added and, with `prune`,
 * works gone from every shelf are dropped. Leave `prune` off when a shelf could not be read.
 */
export function rememberWanted(
  db: Db,
  profileId: string,
  works: (WorkRef & { playable?: boolean })[],
  now: number,
  { prune = true }: { prune?: boolean } = {},
): void {
  const known = new Map(listWanted(db, profileId).map((w) => [workKey(w), w]));
  const keep = new Set(works.map(workKey));
  db.transaction((tx) => {
    for (const work of works) {
      const old = known.get(workKey(work));
      if (old) {
        if (work.playable === true && !old.playable)
          writeWanted(tx, profileId, { ...old, playable: true, checkedAt: now }, now);
        continue;
      }
      writeWanted(
        tx,
        profileId,
        {
          type: work.type,
          id: work.id,
          name: work.name,
          ...(work.author ? { author: work.author } : {}),
          playable: work.playable === true,
          addedAt: now,
          checkedAt: work.playable === undefined ? null : now,
        },
        now,
      );
    }
    for (const [key, old] of known) {
      if (!prune || keep.has(key)) continue;
      tx.delete(settings)
        .where(
          and(eq(settings.profileId, profileId), eq(settings.key, wantedKey(old.type, old.id))),
        )
        .run();
    }
  });
}

/**
 * Asks again for wanted works that had no source, oldest check first, at most `limit` per run.
 * Returns the works that just became playable, already marked so they never alert twice. The
 * first check only sets the baseline: a book that played all along is no news.
 */
export async function checkWanted(
  db: Db,
  profileId: string,
  ask: (work: WantedWork) => Promise<Availability | null>,
  now: number,
  limit = 10,
): Promise<WantedWork[]> {
  const due = listWanted(db, profileId)
    .filter((w) => !w.playable)
    .sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0))
    .slice(0, limit);
  const playable: WantedWork[] = [];
  // One at a time: this runs in the background, where nothing is waiting on it.
  for (const work of due) {
    const answer = await ask(work);
    if (answer === null) continue;
    const next = { ...work, playable: answer.kind !== 'none', checkedAt: now };
    writeWanted(db, profileId, next, now);
    if (next.playable && work.checkedAt !== null) playable.push(next);
  }
  return playable;
}

// Asked once per profile, so declining is never followed by more asking.
const ALERTS_ASKED = 'wanted-alerts-asked';

/** Whether this profile was asked to allow “Now playable” notifications. */
export function wantedAlertsAsked(db: Db, profileId: string): boolean {
  return (
    db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.profileId, profileId), eq(settings.key, ALERTS_ASKED)))
      .get() !== undefined
  );
}

export function setWantedAlertsAsked(db: Db, profileId: string, now: number): void {
  db.insert(settings)
    .values({ profileId, key: ALERTS_ASKED, value: 'true', updatedAt: now })
    .onConflictDoNothing()
    .run();
}
