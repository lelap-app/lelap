import {
  antennaPodFromOpml,
  type AntennaPodData,
  applyAntennaPod,
  applyGoodreads,
  applySmartAudiobook,
  type ImportSummary,
  localRoot,
  isSqlite,
  parseGoodreads,
  parseSabpPosition,
  readAntennaPod,
  SABP_POSITION_FILE,
  type SabpFound,
} from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';

import { db, newId } from './db';
import { showAlert } from './dialog';
import { readPickedBytes, readPickedText } from './platform/files';
import { listTree } from './platform/library';
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

/**
 * Smart AudioBook Player keeps its place in a `position.sabp.dat` in each book folder, so this
 * reads them from the library folder instead of asking for a file.
 */
export async function importSmartAudiobook(onProgress: (text: string) => void): Promise<boolean> {
  const root = localRoot(db);
  if (!root) throw new Error('Choose your audiobooks folder in Settings first.');
  onProgress('Looking for Smart AudioBook Player files…');
  const files = (await listTree(root.uri)).filter((f) => f.name === SABP_POSITION_FILE);
  const found: SabpFound[] = [];
  const unreadable: ImportSummary['skipped'] = [];
  for (const file of files) {
    try {
      found.push({ location: file.location, book: parseSabpPosition(await readPickedBytes(file)) });
    } catch (error) {
      const folder = file.relPath.split('/').slice(-2, -1)[0] ?? file.relPath;
      unreadable.push({
        item: folder,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (files.length === 0) {
    showAlert(
      'Smart AudioBook Player',
      `No ${SABP_POSITION_FILE} files in ${root.name}. Smart AudioBook Player writes one in each book folder it has played.`,
    );
    return false;
  }
  const summary = applySmartAudiobook(db, profileId, found, Date.now());
  summary.skipped.push(...unreadable);
  report(
    'Smart AudioBook Player imported',
    `${summary.matched} of ${files.length} books got their place or finished mark.`,
    summary,
  );
  return true;
}
