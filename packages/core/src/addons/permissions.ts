import type { Manifest } from '@lelap/sdk';

// What an add-on can do, in the words the install sheet shows before anything is installed.
// Add-ons are web services run by others; this lists what the manifest says and what the address
// reveals, so the listener decides with the facts in front of them.

export type Permission = {
  kind: 'catalog' | 'meta' | 'stream' | 'scrobble' | 'artwork' | 'settings' | 'insecure' | 'host';
  text: string;
  /** Worth a second look: it sends the listener's data, or the connection is not encrypted. */
  notable: boolean;
};

const names = (manifest: Manifest) =>
  new Set(manifest.resources.map((r) => (typeof r === 'string' ? r : r.name)));

const KINDS: Record<string, string> = {
  audiobook: 'audiobooks',
  podcast: 'podcasts',
  episode: 'episodes',
};

export function addonPermissions(manifest: Manifest, manifestUrl: string): Permission[] {
  const resources = names(manifest);
  const list: Permission[] = [];
  let host = manifestUrl;
  let secure = true;
  let query = false;
  try {
    const url = new URL(manifestUrl);
    host = url.host;
    secure =
      url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    query = url.search.length > 1 || url.pathname.split('/').some((p) => p.length > 40);
  } catch {
    // Shown as typed.
  }
  const types = [...new Set(manifest.types.map((t) => KINDS[t] ?? t))].join(' and ');

  if (resources.has('catalog') && manifest.catalogs.length > 0) {
    const shown = manifest.catalogs.slice(0, 3).map((c) => c.name);
    const more = manifest.catalogs.length > 3 ? ` and ${manifest.catalogs.length - 3} more` : '';
    list.push({
      kind: 'catalog',
      text: `Shows lists of ${types} on Home, Discover and Search: ${shown.join(', ')}${more}.`,
      notable: false,
    });
  }
  if (resources.has('meta')) {
    list.push({
      kind: 'meta',
      text: 'Looks up details about books: descriptions, narrators, chapters.',
      notable: false,
    });
  }
  if (resources.has('stream')) {
    list.push({
      kind: 'stream',
      text: 'Finds audio to play. The audio comes from the sources it names, never through Lelap.',
      notable: false,
    });
  }
  if (resources.has('artwork')) {
    list.push({
      kind: 'artwork',
      text: 'Supplies covers for items that have none.',
      notable: false,
    });
  }
  if (resources.has('scrobble')) {
    list.push({
      kind: 'scrobble',
      text: 'Receives what you listen to and when: titles, places and finished books. Never your files or links.',
      notable: true,
    });
  }
  if (query) {
    list.push({
      kind: 'settings',
      text: 'Its address holds your settings for it, which may include a key. Keep the address private.',
      notable: true,
    });
  }
  if (!secure) {
    list.push({
      kind: 'insecure',
      text: 'Not encrypted (http). Others on the network can see what Lelap asks it.',
      notable: true,
    });
  }
  list.push({
    kind: 'host',
    text: `Lelap talks to ${host} for it. That service sees what you browse and search through it.`,
    notable: false,
  });
  return list;
}
