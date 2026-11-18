import { catalogCoverName, linkedCoverUrls, looksLikeImage } from '@lelap/core';
import { Directory, File, Paths } from 'expo-file-system';

import { db } from './db';

// Covers from Match with catalog… (M80), kept on this phone so a matched book shows its cover
// offline. The link syncs but the copy doesn't: each device keeps its own, named by the address.

const folder = () => new Directory(Paths.document, 'catalog-covers');
const MAX_BYTES = 10 * 1024 * 1024;

let names: Set<string> | null = null;
// Addresses that failed this session, so each library change doesn't ask again.
const failed = new Set<string>();
const nameOf = new Map<string, string>();

function savedNames(): Set<string> {
  if (!names) {
    const dir = folder();
    names = new Set(
      dir.exists ? dir.list().flatMap((entry) => (entry instanceof File ? [entry.name] : [])) : [],
    );
  }
  return names;
}

function nameFor(url: string): string {
  let name = nameOf.get(url);
  if (!name) {
    name = catalogCoverName(url);
    nameOf.set(url, name);
  }
  return name;
}

/** The `file://` address of a matched cover kept on this phone, or null. */
export function savedCatalogCover(url: string | null | undefined): string | null {
  if (!url) return null;
  const name = nameFor(url);
  return savedNames().has(name) ? new File(folder(), name).uri : null;
}

/** Saves the matched covers not on the phone yet and removes those no book uses any more. */
async function saveCatalogCovers(): Promise<boolean> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true });
  const kept = savedNames();
  const wanted = new Map(linkedCoverUrls(db).map((url) => [nameFor(url), url]));
  let added = false;
  for (const [name, url] of wanted) {
    if (kept.has(name) || failed.has(url)) continue;
    // Partial downloads never stay under the final name, or a broken image would be kept.
    const part = new File(dir, `${name}.part`);
    try {
      if (part.exists) part.delete();
      const file = await File.downloadFileAsync(url, part);
      if (!file.size || file.size > MAX_BYTES) throw new Error('The cover is empty or too big.');
      // A page or an error sent with a 200 would otherwise show as a blank cover for good.
      if (!looksLikeImage(await file.bytes())) throw new Error('The cover is not an image.');
      await part.move(new File(dir, name));
      kept.add(name);
      added = true;
    } catch {
      if (part.exists) part.delete();
      failed.add(url);
    }
  }
  for (const name of [...kept]) {
    if (wanted.has(name)) continue;
    const file = new File(dir, name);
    if (file.exists) file.delete();
    kept.delete(name);
  }
  return added;
}

let running = false;
let again = false;

/**
 * Keeps the matched covers on the phone; run after each library change, such as a match or a
 * sync. `onAdded` runs when a cover arrived, so the lists draw it.
 */
export function syncCatalogCovers(onAdded: () => void): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void saveCatalogCovers()
    .catch(() => false)
    .then((added) => {
      running = false;
      if (added) onAdded();
      if (again) {
        again = false;
        syncCatalogCovers(onAdded);
      }
    });
}
