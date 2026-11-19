import { t } from './i18n';
import {
  antennaPodFromOpml,
  type AntennaPodData,
  applyAntennaPod,
  addWanted,
  applyGoodreads,
  applySmartAudiobook,
  type ImportSummary,
  localRoot,
  lookUpWanted,
  searchCatalogs,
  wantedFromGoodreads,
  isSqlite,
  parseGoodreads,
  parseSabpPosition,
  readAntennaPod,
  SABP_POSITION_FILE,
  type SabpFound,
} from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';

import { fetcher } from './addons';
import { profileAddons } from './availability';
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
  if (more > 0) lines.push(t('…and {n} more', { n: more }));
  showAlert(title, lines.length > 0 ? `${done}\n\n${t('Left out:')}\n${lines.join('\n')}` : done);
}

/**
 * Goodreads CSV: shelves become tags, the "read" shelf a finished mark. Books on the to-read
 * shelf that are not here can be looked up in the catalogs for a Want to read row (M102); the
 * listener is asked first, since their titles go to the catalogs.
 */
export async function importGoodreads(onProgress: (text: string) => void): Promise<boolean> {
  const asset = await pick(['text/csv', 'text/comma-separated-values', 'text/plain', '*/*']);
  if (!asset) return false;
  const items = parseGoodreads(await readPickedText(asset));
  const summary = applyGoodreads(db, profileId, items, Date.now());
  const wanted = wantedFromGoodreads(db, profileId, items);
  const addons = profileAddons();
  const catalogs = [
    ...new Set(searchCatalogs(addons, ['audiobook']).map((r) => r.addon.manifest.name)),
  ];
  const done = t(
    '{matched} of {total} books matched your library. Their shelves are now tags. Goodreads has no audio, so books that are not here were not added.',
    { matched: summary.matched, total: items.length },
  );
  if (wanted.length === 0 || catalogs.length === 0) {
    report(t('{name} imported', { name: 'Goodreads' }), done, summary);
    return true;
  }
  const lookUp = await new Promise<boolean>((resolve) =>
    showAlert(
      t('{name} imported', { name: 'Goodreads' }),
      `${done}\n\n${
        wanted.length === 1
          ? t(
              '1 book on your to-read shelf is not here. Look it up in {names} for a Want to read row on Home? Its title and author go to them.',
              { names: catalogs.join(', ') },
            )
          : t(
              '{n} books on your to-read shelf are not here. Look them up in {names} for a Want to read row on Home? Their titles and authors go to them.',
              { n: wanted.length, names: catalogs.join(', ') },
            )
      }`,
      [
        { text: t('Not now'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('Look up'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
  if (!lookUp) return true;
  const found = await lookUpWanted(fetcher, addons, wanted, (i, n) =>
    onProgress(t('Looking up book {i} of {n}…', { i: Math.min(i + 1, n), n })),
  );
  const added = addWanted(
    db,
    profileId,
    found.found.map((m) => ({
      type: m.type,
      id: m.id,
      name: m.name,
      ...(m.author ? { author: m.author } : {}),
      ...(m.cover ? { cover: m.cover } : {}),
    })),
    GOODREADS,
    Date.now(),
  );
  const lines = [
    t('{found} of {total} books are now on Want to read.', { found: added, total: wanted.length }),
    ...(found.failed.length > 0
      ? [t('{names} did not answer.', { names: found.failed.join(', ') })]
      : []),
  ];
  report(t('Want to read'), lines.join('\n'), {
    matched: added,
    skipped: found.missing.map((title) => ({ item: title, reason: t('Not in the catalogs') })),
  });
  return true;
}

/** The `from` of works a Goodreads import put on Want to read. */
export const GOODREADS = 'goodreads';

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
    t('{name} imported', { name: 'AntennaPod' }),
    t('Subscribed to {n} podcasts; played marks and places came along.', {
      n:
        data.feeds.length -
        summary.skipped.filter((s) => s.reason === 'The feed could not be loaded').length,
    }),
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
  if (!root) throw new Error(t('Choose your audiobooks folder in Settings first.'));
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
      t(
        'No {file} files in {folder}. Smart AudioBook Player writes one in each book folder it has played.',
        { file: SABP_POSITION_FILE, folder: root.name },
      ),
    );
    return false;
  }
  const summary = applySmartAudiobook(db, profileId, found, Date.now());
  summary.skipped.push(...unreadable);
  report(
    t('{name} imported', { name: 'Smart AudioBook Player' }),
    t('{matched} of {total} books got their place or finished mark.', {
      matched: summary.matched,
      total: files.length,
    }),
    summary,
  );
  return true;
}
