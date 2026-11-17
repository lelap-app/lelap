import {
  antennaPodFromOpml,
  type AntennaPodData,
  applyAntennaPod,
  applyGoodreads,
  type ImportSummary,
  isSqlite,
  parseGoodreads,
  readAntennaPod,
} from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';

import { db, newId } from './db';
import { showAlert } from './dialog';
import { readPickedBytes, readPickedText } from './platform/files';
import { openSqliteFile } from './platform/sqliteFile';
import { fetchFeed } from './podcasts';
import { profileId } from './profile';

const SHOWN_SKIPS = 8;

async function pick(type: string[]) {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type });
  return picked.canceled ? undefined : picked.assets[0];
}

function report(title: string, done: string, summary: ImportSummary): void {
  const lines = summary.skipped.slice(0, SHOWN_SKIPS).map((s) => `• ${s.item}: ${s.reason}`);
  const more = summary.skipped.length - lines.length;
  if (more > 0) lines.push(`…and ${more} more`);
  showAlert(title, lines.length > 0 ? `${done}\n\nLeft out:\n${lines.join('\n')}` : done);
}

/** Goodreads CSV: shelves become tags, the "read" shelf a finished mark. */
export async function importGoodreads(): Promise<boolean> {
  const asset = await pick(['text/csv', 'text/comma-separated-values', 'text/plain', '*/*']);
  if (!asset) return false;
  const items = parseGoodreads(await readPickedText(asset));
  const summary = applyGoodreads(db, profileId, items, Date.now());
  report(
    'Goodreads imported',
    `${summary.matched} of ${items.length} books matched your library. Their shelves are now tags. Goodreads has no audio, so books that are not here were not added.`,
    summary,
  );
  return true;
}

async function readAntennaPodFile(asset: { uri: string }): Promise<AntennaPodData> {
  const bytes = await readPickedBytes(asset);
  if (!isSqlite(bytes)) return antennaPodFromOpml(new TextDecoder().decode(bytes));
  const file = await openSqliteFile(bytes);
  try {
    return await readAntennaPod(file.all);
  } finally {
    await file.close();
  }
}

/**
 * AntennaPod database export (or OPML): subscriptions, played marks and places. Each feed is
 * fetched first, so its episodes are here to carry the marks.
 */
export async function importAntennaPod(onProgress: (text: string) => void): Promise<boolean> {
  const asset = await pick(['application/octet-stream', 'application/x-sqlite3', '*/*']);
  if (!asset) return false;
  const data = await readAntennaPodFile(asset);
  for (const [i, feed] of data.feeds.entries()) {
    onProgress(`Loading feed ${i + 1} of ${data.feeds.length}`);
    // A feed that fails is reported by applyAntennaPod as not loaded.
    await fetchFeed(feed.feedUrl).catch(() => null);
  }
  const summary = applyAntennaPod(db, profileId, data, Date.now(), newId);
  report(
    'AntennaPod imported',
    `Subscribed to ${data.feeds.length - summary.skipped.filter((s) => s.reason === 'The feed could not be loaded').length} podcasts; played marks and places came along.`,
    summary,
  );
  return true;
}
