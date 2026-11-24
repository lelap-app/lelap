// Which over-the-air updates the downloads bucket keeps (M159). The release workflow
// (`scripts/ota-prune.mts`) keeps a list of what it published, since R2 can't be listed with the
// release token, and removes what this file picks. No imports, so Node runs it with type stripping.

/** The list of published updates, next to the channel records. */
export const HISTORY_KEY = 'ota/history.json';

/** The newest updates kept per channel, besides every one a channel record points at. */
export const KEEP_PER_CHANNEL = 5;

export type UpdateEntry = {
  runtimeVersion: string;
  /** The update ID, as in its manifest. */
  id: string;
  /** When the release workflow published it, as an ISO date. */
  publishedAt: string;
  channels: string[];
  /** Its files' keys in the bucket, all under `ota/<runtime>/<id>/`. */
  files: string[];
};

export type History = { updates: UpdateEntry[] };

const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const UPDATE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Files are named by content (`manifest.ts`, `fileName`): an MD5 and a short extension.
const FILE_NAME = /^[0-9a-f]{32}\.[a-z0-9]{1,10}$/;

/** The folder an update's files are in. */
export const updateFolder = (runtimeVersion: string, id: string): string =>
  `ota/${runtimeVersion}/${id}/`;

/** Whether `key` is one of the update's own files: the only kind of key this file ever removes. */
export function isUpdateFile(
  entry: Pick<UpdateEntry, 'runtimeVersion' | 'id'>,
  key: string,
): boolean {
  if (!SAFE_NAME.test(entry.runtimeVersion) || !UPDATE_ID.test(entry.id)) return false;
  const folder = updateFolder(entry.runtimeVersion, entry.id);
  return key.startsWith(folder) && FILE_NAME.test(key.slice(folder.length));
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

function readEntry(value: unknown): UpdateEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const { runtimeVersion, id, publishedAt, channels, files } = value as Record<string, unknown>;
  if (typeof runtimeVersion !== 'string' || typeof id !== 'string') return null;
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) return null;
  if (!isStrings(channels) || !isStrings(files)) return null;
  return { runtimeVersion, id, publishedAt, channels, files };
}

/**
 * The list as the bucket holds it: empty when there is none yet, null when it can't be read, so
 * the caller removes nothing rather than forget what was published.
 */
export function parseHistory(text: string | null): History | null {
  if (text === null || text.trim() === '') return { updates: [] };
  try {
    const value: unknown = JSON.parse(text);
    const updates = (value as { updates?: unknown } | null)?.updates;
    if (!Array.isArray(updates)) return null;
    const read = updates.map(readEntry);
    return read.every((e): e is UpdateEntry => e !== null) ? { updates: read } : null;
  } catch {
    return null;
  }
}

/**
 * The list with an update just published added. The same update again (a beta's code released as
 * stable) joins the channels and counts from its newest publication.
 */
export function recordUpdate(history: History, entry: UpdateEntry): History {
  const same = (e: UpdateEntry) => e.runtimeVersion === entry.runtimeVersion && e.id === entry.id;
  const earlier = history.updates.find(same);
  const merged: UpdateEntry = earlier
    ? {
        ...entry,
        channels: [...new Set([...earlier.channels, ...entry.channels])],
        files: [...new Set([...earlier.files, ...entry.files])],
        publishedAt:
          Date.parse(earlier.publishedAt) > Date.parse(entry.publishedAt)
            ? earlier.publishedAt
            : entry.publishedAt,
      }
    : entry;
  return { updates: [...history.updates.filter((e) => !same(e)), merged] };
}

/** `runtime/id`, as the live channel records name an update. */
export const updateKey = (e: Pick<UpdateEntry, 'runtimeVersion' | 'id'>): string =>
  `${e.runtimeVersion}/${e.id}`;

export type Pruning = { history: History; remove: string[] };

/**
 * What to keep and what to remove. Kept: every update a live channel record points at
 * (`pointedAt`, as `runtime/id`), the newest of each channel and runtime version (the record's,
 * as far as the list knows), and the newest `keep` of each channel. The rest is removed, its own
 * files only, never one a kept update also lists.
 */
export function pickRemovals(
  history: History,
  pointedAt: ReadonlySet<string>,
  keep: number = KEEP_PER_CHANNEL,
): Pruning {
  const newestFirst = [...history.updates].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  const kept = new Set<UpdateEntry>(newestFirst.filter((e) => pointedAt.has(updateKey(e))));
  const counted = new Map<string, number>();
  const recordSeen = new Set<string>();
  for (const entry of newestFirst) {
    for (const channel of entry.channels) {
      const record = `${channel}/${entry.runtimeVersion}`;
      if (!recordSeen.has(record)) {
        recordSeen.add(record);
        kept.add(entry);
      }
      const n = counted.get(channel) ?? 0;
      if (n < keep) kept.add(entry);
      counted.set(channel, n + 1);
    }
  }
  const keptFiles = new Set([...kept].flatMap((e) => e.files));
  const remove = newestFirst
    .filter((e) => !kept.has(e))
    .flatMap((e) => e.files.filter((key) => isUpdateFile(e, key) && !keptFiles.has(key)));
  return {
    history: { updates: history.updates.filter((e) => kept.has(e)) },
    remove: [...new Set(remove)],
  };
}
