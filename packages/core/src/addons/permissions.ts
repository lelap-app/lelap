import type { Manifest } from '@lelap/sdk';

// What an add-on can do, in the words the install sheet shows before anything is installed.
// Add-ons are web services run by others; this lists what the manifest says and what the address
// reveals, so the listener decides with the facts in front of them.

export type Permission = {
  kind:
    | 'catalog'
    | 'meta'
    | 'stream'
    | 'scrobble'
    | 'artwork'
    | 'series'
    | 'library'
    | 'login'
    | 'settings'
    | 'insecure'
    | 'host'
    | 'sandbox';
  text: string;
  /** Worth a second look: it sends the listener's data, or the connection is not encrypted. */
  notable: boolean;
};

/**
 * The app's `t()`: English is the key, `{holes}` are filled from `vars`. Lines written through it
 * here are checked against the app's catalogs like the app's own.
 */
export type Translate = (text: string, vars?: Record<string, string | number>) => string;

const english: Translate = (text, vars) =>
  text.replace(/\{(\w+)\}/g, (hole, key: string) =>
    vars && key in vars ? String(vars[key]) : hole,
  );

const names = (manifest: Manifest) =>
  new Set(manifest.resources.map((r) => (typeof r === 'string' ? r : r.name)));

const kindName = (t: Translate, type: string) =>
  type === 'audiobook'
    ? t('audiobooks')
    : type === 'podcast'
      ? t('podcasts')
      : type === 'episode'
        ? t('episodes')
        : type;

/** `a, b and c`, in the language `t` speaks. */
const listed = (t: Translate, items: readonly string[]) =>
  items.length < 2
    ? (items[0] ?? '')
    : t('{list} and {last}', { list: items.slice(0, -1).join(', '), last: items.at(-1) ?? '' });

export function addonPermissions(
  manifest: Manifest,
  manifestUrl: string,
  t: Translate = english,
): Permission[] {
  const resources = names(manifest);
  const list: Permission[] = [];
  let host = manifestUrl;
  let secure = true;
  let query = false;
  // An add-on inside the app has no address of its own to judge.
  const local = manifestUrl.startsWith('lelap-local://');
  try {
    if (local) throw new Error('local');
    const url = new URL(manifestUrl);
    host = url.host;
    secure =
      url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    query = url.search.length > 1 || url.pathname.split('/').some((p) => p.length > 40);
  } catch {
    // Shown as typed.
  }
  if (local) {
    secure = true;
    query = false;
  }
  const types = listed(t, [...new Set(manifest.types.map((type) => kindName(t, type)))]);

  if (resources.has('catalog') && manifest.catalogs.length > 0) {
    const shown = manifest.catalogs.slice(0, 3).map((c) => c.name);
    const lists =
      manifest.catalogs.length > 3
        ? t('{names} and {n} more', { names: shown.join(', '), n: manifest.catalogs.length - 3 })
        : shown.join(', ');
    list.push({
      kind: 'catalog',
      text: t('Shows lists of {types} on Home, Discover and Search: {lists}.', { types, lists }),
      notable: false,
    });
  }
  if (resources.has('meta')) {
    list.push({
      kind: 'meta',
      text: t('Looks up details about books: descriptions, narrators, chapters.'),
      notable: false,
    });
  }
  if (resources.has('stream')) {
    list.push({
      kind: 'stream',
      text: t(
        'Finds audio to play. The audio comes from the sources it names, never through Lelap.',
      ),
      notable: false,
    });
  }
  if (resources.has('artwork')) {
    list.push({
      kind: 'artwork',
      text: t('Supplies covers for items that have none.'),
      notable: false,
    });
  }
  if (resources.has('series')) {
    list.push({
      kind: 'series',
      text: t(
        'Lists every book of a series you open, in reading order. It gets the series’ name, its author, your language and a catalog book you matched in it.',
      ),
      notable: false,
    });
  }
  if (resources.has('library') && manifest.sandbox) {
    list.push({
      kind: 'library',
      text: t(
        'Lists the books on a server you add under Settings → Library and sources → Add a server, so they play and download like your own.',
      ),
      notable: false,
    });
  }
  if (manifest.sandbox && (manifest.settings ?? []).length > 0) {
    const signin = (manifest.settings ?? []).some((f) => f.type === 'signin');
    list.push({
      kind: 'login',
      text: signin
        ? t(
            'Signs you in on a website it names when you add a server, with a code you enter there. What it gets back stays sealed on this device and reaches only this add-on.',
          )
        : t(
            'Asks for an address and login when you add a server. They stay sealed on this device and reach only this add-on.',
          ),
      notable: false,
    });
  }
  if (resources.has('scrobble')) {
    list.push({
      kind: 'scrobble',
      text: t(
        'Receives what you listen to and when: titles, places and finished books. Never your files or links.',
      ),
      notable: true,
    });
  }
  if (query) {
    list.push({
      kind: 'settings',
      text: t(
        'Its address holds your settings for it, which may include a key. Keep the address private.',
      ),
      notable: true,
    });
  }
  if (!secure) {
    list.push({
      kind: 'insecure',
      text: t('Not encrypted (http). Others on the network can see what Lelap asks it.'),
      notable: true,
    });
  }
  // Only code inside the app runs in the sandbox; a web add-on saying `sandbox` is still a service.
  if (manifest.sandbox && local) {
    const hosts = manifest.sandbox.hosts;
    const typed = (manifest.settings ?? []).some((f) => f.type === 'url' && f.host === true);
    list.push({
      kind: 'sandbox',
      text: typed
        ? hosts.length > 0
          ? t(
              'Runs on this device, in a sandbox. It can reach only {hosts} and the address you enter.',
              { hosts: hosts.join(', ') },
            )
          : t('Runs on this device, in a sandbox. It can reach only the address you enter.')
        : hosts.length > 0
          ? t('Runs on this device, in a sandbox. It can reach only {hosts}.', {
              hosts: hosts.join(', '),
            })
          : t('Runs on this device, in a sandbox, with no network at all.'),
      notable: hosts.some((h) => h.startsWith('*')),
    });
    return list;
  }
  list.push({
    kind: 'host',
    text: t(
      'Lelap talks to {host} for it. That service sees what you browse and search through it.',
      {
        host,
      },
    ),
    notable: false,
  });
  return list;
}

/**
 * Whether an update of an installed add-on asks for more than it had: a kind of permission the
 * installed one lacked, such as `scrobble` or plain http, or a host it couldn't reach. The app
 * then shows the review sheet instead of a plain “Update?”.
 */
export function asksForMore(
  installed: { manifest: Manifest; url: string },
  update: { manifest: Manifest; url: string },
): boolean {
  const before = new Set(addonPermissions(installed.manifest, installed.url).map((p) => p.kind));
  if (addonPermissions(update.manifest, update.url).some((p) => !before.has(p.kind))) return true;
  const hosts = new Set(installed.manifest.sandbox?.hosts ?? []);
  return (update.manifest.sandbox?.hosts ?? []).some((h) => !hosts.has(h));
}
