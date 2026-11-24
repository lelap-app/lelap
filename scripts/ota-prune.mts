// Picks old over-the-air updates to remove from the downloads bucket, for the tag workflow (M159),
// run with Node's type stripping after `ota.mts`'s files are uploaded:
//   node scripts/ota-prune.mts PUBLISHED DOWNLOADS_BASE OUT
// PUBLISHED is `ota.mts`'s output folder (the update just published and its channel records).
// It reads the list of published updates and every live channel record from DOWNLOADS_BASE, and
// writes OUT/ota/history.json (the new list, uploaded first) and OUT/remove.txt (one bucket key
// a line). Nothing is removed here. When the list or a record can't be read for sure, it writes
// nothing and the workflow removes nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HISTORY_KEY,
  type History,
  parseHistory,
  pickRemovals,
  recordUpdate,
  type UpdateEntry,
  updateFolder,
  updateKey,
} from '../services/updates/src/history.ts';
import {
  manifestId,
  parsePublished,
  publishedKey,
  SAFE_NAME,
} from '../services/updates/src/published.ts';

const [published, downloads, out] = process.argv.slice(2);
if (!published || !downloads || !out) {
  console.error('Usage: ota-prune.mts PUBLISHED DOWNLOADS_BASE OUT');
  process.exit(1);
}
const base = downloads.replace(/\/$/, '');

/** Stops without writing anything: the workflow then removes nothing. */
function skip(reason: string): never {
  console.log(`::notice::No old updates removed: ${reason}`);
  process.exit(0);
}

/** A file from the bucket: its text, null when there is none (404), or a skip on anything else. */
async function readBucket(key: string): Promise<string | null> {
  // A fresh copy past the CDN: a list or record older than the upload could hide an update.
  const url = `${base}/${key}?fresh=${Date.now()}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    skip(`${key} could not be read`);
  }
  if (response.status === 404) return null;
  if (!response.ok) skip(`${key} answered ${response.status}`);
  return response.text();
}

// The update just published: its channel records name it, its folder holds its files.
const channelsDir = join(published, 'ota', 'channels');
const now = new Date().toISOString();
let entry: UpdateEntry | null = null;
for (const channel of readdirSync(channelsDir)) {
  for (const record of readdirSync(join(channelsDir, channel))) {
    const runtimeVersion = record.replace(/\.json$/, '');
    const text = readFileSync(join(channelsDir, channel, record), 'utf8');
    const id = manifestId(parsePublished(text)?.manifest ?? '');
    if (!id || !SAFE_NAME.test(runtimeVersion)) skip(`unreadable record ${channel}/${record}`);
    if (entry && (entry.id !== id || entry.runtimeVersion !== runtimeVersion))
      skip('the channel records name different updates');
    entry ??= { runtimeVersion, id, publishedAt: now, channels: [], files: [] };
    entry.channels.push(channel);
  }
}
if (!entry) skip('no channel record was published');
const folder = updateFolder(entry.runtimeVersion, entry.id);
const local = join(published, folder);
if (!existsSync(local)) skip(`no files in ${folder}`);
entry.files = readdirSync(local).map((name) => `${folder}${name}`);

const listed = parseHistory(await readBucket(HISTORY_KEY));
if (!listed) skip(`${HISTORY_KEY} is not a list of updates`);
const history: History = recordUpdate(listed, entry);

// What every live record points at, read back from the bucket: never removed, whatever the list says.
const pointedAt = new Set<string>();
const records = new Set(
  history.updates.flatMap((e) => e.channels.map((c) => publishedKey(c, e.runtimeVersion))),
);
for (const key of records) {
  const text = await readBucket(key);
  if (text === null) continue;
  const id = manifestId(parsePublished(text)?.manifest ?? '');
  if (!id) skip(`${key} is not a signed record`);
  const runtimeVersion = key.slice(key.lastIndexOf('/') + 1).replace(/\.json$/, '');
  pointedAt.add(updateKey({ runtimeVersion, id }));
}

const pruning = pickRemovals(history, pointedAt);
mkdirSync(join(out, 'ota'), { recursive: true });
writeFileSync(join(out, HISTORY_KEY), JSON.stringify(pruning.history, null, 2));
writeFileSync(join(out, 'remove.txt'), pruning.remove.map((key) => `${key}\n`).join(''));
console.log(
  JSON.stringify({
    kept: pruning.history.updates.map(updateKey),
    removedFiles: pruning.remove.length,
  }),
);
