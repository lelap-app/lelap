/* global addon, lelap */
// Bundled with Lelap (M59): audiobooks in the music libraries of a Plex Media Server. It runs in
// the app's sandbox and can reach plex.tv and the server addresses in its form, nothing else.
//
// Signing in uses plex.tv's PIN flow: the app shows a code, the listener enters it at
// plex.tv/link, and the add-on asks plex.tv for the token until it is there. Lelap never sees the
// Plex password. The sign-in then looks up the listener's servers on plex.tv and fills in the
// server's address at home and its own address away from home, never a Plex relay; the listener
// sees both in the form, and the app lets the add-on reach only those (M57's host rule for typed
// addresses). Before the server's token goes to an address, that address must say it is the
// server plex.tv named. Audio streams from the server with `X-Plex-Token` as a header, or in the
// address in the browser (`webQuery`), sealed on the phone either way.

const PRODUCT = 'Lelap';
const VERSION = '1.0.0';
const PLEX_TV = 'https://plex.tv';
const PAGE = 500;
const MAX_PAGES = 200;
const MAX_FILES = 50000;
const AUDIO = new Set(['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav']);
const BY_CONTAINER = { mp4: 'm4b', mpeg: 'mp3', oga: 'ogg' };
// Music libraries used for audiobooks are found by name when the listener names none.
const BOOKISH = /audio ?books?|h(ö|oe)rb(ü|ue)cher|livres audio|buku audio|book/i;

// Tracks by the path of their file on the server, from this server's last listing, so a place can
// be saved on the track whichever of its addresses answers; and the last address that answered.
// Each server has a sandbox of its own, so nothing here is shared.
const tracks = new Map();
let connected = null;

const enc = encodeURIComponent;
const queryOf = (params) =>
  Object.entries(params)
    .map(([name, value]) => `${enc(name)}=${enc(value)}`)
    .join('&');

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The sign-in field's value: this device's client ID for Plex, the token, and the server's ID. */
function accountOf(settings) {
  try {
    const account = JSON.parse(settings.account || '');
    if (account && typeof account.token === 'string' && typeof account.client === 'string') {
      return account;
    }
  } catch {
    // Not signed in.
  }
  return null;
}

function plexHeaders(client, token) {
  return {
    Accept: 'application/json',
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': client,
    'X-Plex-Device-Name': PRODUCT,
    ...(token ? { 'X-Plex-Token': token } : {}),
  };
}

// Errors name the problem, never an address: an address could carry the token.
async function json(response, who) {
  if (response.status === 401 || response.status === 403) {
    const error = new Error(`${who} refused the sign-in. Sign in again.`);
    error.refused = true;
    throw error;
  }
  if (!response.ok) throw new Error(`${who} answered HTTP ${response.status}.`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${who} did not answer in JSON.`);
  }
}

const tv = async (path, client, token, init = {}) =>
  json(
    await lelap.fetch(`${PLEX_TV}${path}`, {
      ...init,
      headers: plexHeaders(client, token),
    }),
    'plex.tv',
  );

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/** The listener's Plex servers, as plex.tv lists them, with their connections. */
async function servers(client, token) {
  const reply = await tv(
    `/api/v2/resources?${queryOf({ includeHttps: '1', includeRelay: '0', includeIPv6: '1' })}`,
    client,
    token,
  );
  return list(reply).filter(
    (r) =>
      r &&
      String(r.provides || '')
        .split(',')
        .includes('server') &&
      r.clientIdentifier,
  );
}

function pickServer(found, name, machine) {
  const wanted = String(name || '')
    .trim()
    .toLowerCase();
  return (
    (wanted &&
      found.find(
        (r) =>
          String(r.name || '')
            .trim()
            .toLowerCase() === wanted,
      )) ||
    (machine && found.find((r) => r.clientIdentifier === machine)) ||
    (wanted ? null : found.find((r) => r.owned) || found[0]) ||
    null
  );
}

const httpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
};

/**
 * The server's address at home and away: a local connection first, then one of its own on the
 * internet; https before http. Relayed connections go through Plex's servers, so never those.
 */
function addressesOf(server) {
  const usable = list(server.connections).filter((c) => c && !c.relay && httpUrl(c.uri));
  const order = (a, b) =>
    (a.protocol === 'https' ? 0 : 1) - (b.protocol === 'https' ? 0 : 1) ||
    (a.IPv6 ? 1 : 0) - (b.IPv6 ? 1 : 0);
  const local = usable.filter((c) => c.local).sort(order)[0];
  const away = usable.filter((c) => !c.local).sort(order)[0];
  const origin = (c) => (c ? httpUrl(c.uri).origin : '');
  return { local: origin(local), away: origin(away) };
}

/** Step one of signing in: a PIN from plex.tv, entered at plex.tv/link. */
async function signinStart(settings) {
  // Signing in again keeps this device's ID, so plex.tv lists it once.
  const client = (accountOf(settings) || {}).client || randomId();
  const pin = await tv('/api/v2/pins', client, '', { method: 'POST' });
  if (!pin || !pin.id || !pin.code) throw new Error('plex.tv did not give a code.');
  const expires = Date.parse(pin.expiresAt || '');
  return {
    code: String(pin.code),
    url: 'https://plex.tv/link',
    ...(Number.isFinite(expires) && expires > 0 ? { expiresAt: expires } : {}),
    interval: 2,
    state: JSON.stringify({ id: pin.id, code: pin.code, client }),
  };
}

/** Step two: the token once the listener entered the code, and the server it reaches. */
async function signinCheck(settings, signin) {
  let state;
  try {
    state = JSON.parse((signin && signin.state) || '');
  } catch {
    throw new Error('The sign-in was lost. Sign in again.');
  }
  const response = await lelap.fetch(
    `${PLEX_TV}/api/v2/pins/${enc(state.id)}?${queryOf({ code: state.code })}`,
    { headers: plexHeaders(state.client, '') },
  );
  if (response.status === 404) throw new Error('The code ran out. Sign in again for a new one.');
  const pin = await json(response, 'plex.tv');
  if (!pin || !pin.authToken) return {};
  const token = String(pin.authToken);
  const found = await servers(state.client, token);
  const server = pickServer(found, settings.server, null);
  if (!server) {
    throw new Error(
      settings.server
        ? `This Plex account has no server called “${String(settings.server).trim()}”.`
        : 'This Plex account has no Plex Media Server.',
    );
  }
  const { local, away } = addressesOf(server);
  // The server's own token is kept too, for when plex.tv can't be asked; a server shared by a
  // friend never gets the account's token.
  const account = {
    client: state.client,
    token,
    machine: server.clientIdentifier,
    ...(server.accessToken ? { server: String(server.accessToken) } : {}),
    ...(server.owned ? { owned: true } : {}),
  };
  return {
    settings: {
      account: JSON.stringify(account),
      server: String(server.name || ''),
      ...(local ? { url: local } : {}),
      ...(away ? { remote: away } : {}),
    },
  };
}

/**
 * The server's token, and its ID to check addresses against. When plex.tv can't be reached, such
 * as at home without internet, the token kept from the sign-in; the account's own token only for
 * the listener's own server.
 */
async function serverLogin(settings, account) {
  let found = null;
  try {
    found = await servers(account.client, account.token);
  } catch (error) {
    // plex.tv no longer takes the token: the listener signs in again.
    if (error && error.refused) throw error;
  }
  if (found) {
    const server = pickServer(found, settings.server, account.machine);
    if (!server) throw new Error('plex.tv no longer lists this server. Sign in again.');
    const own = server.owned === true;
    const token = server.accessToken || (own ? account.token : '');
    if (!token) throw new Error('plex.tv gave no token for this server. Sign in again.');
    return { token: String(token), machine: String(server.clientIdentifier) };
  }
  const token = account.server || (account.owned ? account.token : '');
  if (!token) throw new Error('plex.tv did not answer. Try again later.');
  return { token, machine: account.machine || null };
}

const baseOf = (address) => {
  const url = httpUrl(address);
  return url ? url.origin : null;
};

/**
 * The first of the server's addresses that answers as that server; it gets no token before.
 * `first` is tried first, such as the address a file was listed from.
 */
async function reachable(settings, account, login, first) {
  const bases = [...new Set([first, settings.url, settings.remote].map(baseOf).filter(Boolean))]
    // Only the form's addresses.
    .filter((base) => base === baseOf(settings.url) || base === baseOf(settings.remote));
  if (bases.length === 0) throw new Error('Sign in again: Lelap has no address for the server.');
  let last = null;
  for (const base of bases) {
    try {
      const reply = await json(
        await lelap.fetch(`${base}/identity`, { headers: plexHeaders(account.client, '') }),
        'The Plex server',
      );
      const id = reply && reply.MediaContainer && reply.MediaContainer.machineIdentifier;
      if (login.machine && id !== login.machine) {
        last = new Error('Another Plex server answers at the server’s address. Sign in again.');
        continue;
      }
      return base;
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error('The Plex server did not answer.');
}

const pms = async (s, path, params = {}) => {
  const query = queryOf(params);
  return json(
    await lelap.fetch(`${s.base}${path}${query ? `?${query}` : ''}`, {
      headers: plexHeaders(s.client, s.token),
    }),
    'The Plex server',
  );
};

async function connect(settings, first) {
  const account = accountOf(settings);
  if (!account) throw new Error('Sign in with Plex first.');
  const login = await serverLogin(settings, account);
  const base = await reachable(settings, account, login, first);
  connected = {
    key: JSON.stringify([settings.account, settings.url, settings.remote, settings.server]),
    s: { base, client: account.client, token: login.token },
  };
  return connected.s;
}

/** The music libraries to take books from: those named, or those named like audiobooks. */
async function sectionsOf(s, names) {
  const reply = await pms(s, '/library/sections');
  const music = list(reply && reply.MediaContainer && reply.MediaContainer.Directory).filter(
    (d) => d && d.type === 'artist' && d.key !== undefined,
  );
  const shown = music.map((d) => `“${d.title}”`).join(', ') || 'none';
  const wanted = String(names || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  if (wanted.length === 0) {
    const books = music.filter((d) => BOOKISH.test(String(d.title || '')));
    if (books.length === 0) {
      throw new Error(
        `Name the music libraries that hold your audiobooks under Libraries. This server has ${shown}.`,
      );
    }
    return books;
  }
  return wanted.map((name) => {
    const found = music.find(
      (d) =>
        String(d.title || '')
          .trim()
          .toLowerCase() === name.toLowerCase(),
    );
    if (!found) {
      throw new Error(`The Plex server has no music library called “${name}”. It has ${shown}.`);
    }
    return found;
  });
}

async function tracksOf(s, section) {
  const found = [];
  for (let page = 0; page < MAX_PAGES && found.length < MAX_FILES; page++) {
    const reply = await pms(s, `/library/sections/${enc(section.key)}/all`, {
      type: '10',
      'X-Plex-Container-Start': String(page * PAGE),
      'X-Plex-Container-Size': String(PAGE),
    });
    const container = (reply && reply.MediaContainer) || {};
    const metadata = list(container.Metadata);
    found.push(...metadata);
    const total = Number(container.totalSize);
    if (metadata.length < PAGE || (Number.isFinite(total) && found.length >= total)) break;
  }
  return found;
}

/** A folder or file name: no slashes, no `.` or `..`, not empty. */
function clean(name, fallback) {
  const text = String(name || '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 200)
    .trim();
  return text || fallback;
}

const partOf = (track) => {
  const media = list(track.Media)[0];
  return media ? list(media.Part)[0] || null : null;
};

function suffixOf(track, part) {
  const file = String(part.file || part.key || '');
  const dot = file.lastIndexOf('.');
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
  if (AUDIO.has(ext)) return ext;
  const media = list(track.Media)[0] || {};
  const container = String(part.container || media.container || '').toLowerCase();
  if (AUDIO.has(container)) return container;
  return BY_CONTAINER[container] || null;
}

/** The listener's place in a track as Plex keeps it; null when there is none. */
function placeOf(track) {
  const offset = Math.round(Number(track.viewOffset) || 0);
  const played = Number(track.viewCount) > 0;
  if (offset <= 0 && !played) return null;
  const at = Math.round(Number(track.lastViewedAt) * 1000);
  return {
    positionMs: Math.max(0, offset),
    at: Number.isFinite(at) && at > 0 ? at : 0,
    ...(played && offset <= 0 ? { played: true } : {}),
  };
}

// A changed picture gets a new address; its hash stands in for a time.
function stamp(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const partAddress = (s, part) => {
  const key = String(part.key || '');
  // Part keys are paths on the server; anything else is left out.
  return key.startsWith('/library/parts/') ? `${s.base}${key}` : null;
};

/**
 * Each album is a book, in a folder named after its author (the album artist) and title, its
 * tracks in disc and track order. The first track of a book has no tags here, so the app reads
 * that one itself: Plex gives no chapters or ISBN and ASIN tags for music, and a single-file book
 * often carries both.
 */
function filesOf(s, found) {
  const albums = new Map();
  const seen = new Set();
  for (const track of found) {
    if (!track || !track.ratingKey || seen.has(String(track.ratingKey))) continue;
    seen.add(String(track.ratingKey));
    const key = String(track.parentRatingKey || `${track.parentTitle}|${track.grandparentTitle}`);
    if (!albums.has(key)) albums.set(key, []);
    albums.get(key).push(track);
  }
  const files = [];
  const folders = new Set();
  for (const key of [...albums.keys()].sort()) {
    const parts = albums
      .get(key)
      .sort(
        (a, b) =>
          (a.parentIndex || 1) - (b.parentIndex || 1) ||
          (a.index || 0) - (b.index || 0) ||
          String(a.title || '').localeCompare(String(b.title || '')) ||
          String(a.ratingKey).localeCompare(String(b.ratingKey)),
      );
    const first = parts[0];
    const author = first.grandparentTitle || first.originalTitle || '';
    const title = first.parentTitle || first.title || '';
    let folder = `${clean(author, 'Unknown author')}/${clean(title, 'Untitled')}`;
    // Two books by one author with one title stay apart.
    if (folders.has(folder.toLowerCase())) folder += ` (${clean(key, 'book')})`;
    folders.add(folder.toLowerCase());

    parts.forEach((track, i) => {
      const part = partOf(track);
      const url = part && partAddress(s, part);
      const suffix = part && suffixOf(track, part);
      if (!url || !suffix || files.length >= MAX_FILES) return;
      tracks.set(String(part.key), String(track.ratingKey));
      const number = String(i + 1).padStart(3, '0');
      const name = track.title ? `${number} ${clean(track.title, '')}` : number;
      const added = Math.round(Number(track.updatedAt || track.addedAt) * 1000);
      const duration = Number(track.duration);
      const place = placeOf(track);
      files.push({
        path: `${folder}/${name}.${suffix}`,
        url,
        downloadUrl: `${url}?download=1`,
        ...(Number.isSafeInteger(part.size) && part.size >= 0 ? { size: part.size } : {}),
        ...(Number.isFinite(added) && added > 0 ? { modifiedAt: added } : {}),
        ...(i > 0 && Number.isFinite(duration) && duration >= 0
          ? {
              durationMs: Math.round(duration),
              title: track.title || undefined,
              album: title || undefined,
              artist: track.originalTitle || author || undefined,
              albumArtist: author || undefined,
            }
          : {}),
        ...(place ? { place } : {}),
      });
    });
    const thumb = String(first.parentThumb || first.thumb || '');
    if (thumb.startsWith('/library/') && files.length < MAX_FILES) {
      files.push({
        path: `${folder}/cover.jpg`,
        url: `${s.base}${thumb}`,
        modifiedAt: stamp(thumb),
      });
    }
  }
  return files;
}

async function library(settings) {
  const s = await connect(settings);
  const sections = await sectionsOf(s, settings.libraries);
  const found = [];
  for (const section of sections) found.push(...(await tracksOf(s, section)));
  tracks.clear();
  return {
    files: filesOf(s, found),
    headers: { 'X-Plex-Token': s.token },
    webQuery: { 'X-Plex-Token': s.token },
  };
}

const LIBRARY = 'com.plexapp.plugins.library';

/** Saves the listener's place as the track's view offset, or marks it played at the end. */
async function place(settings, report) {
  const url = httpUrl(report.file.url);
  if (!url) return { saved: false };
  // The connection of the last listing or report, while the form is the same; else the address
  // the file was listed from first, so a report doesn't wait on the other one.
  const key = JSON.stringify([settings.account, settings.url, settings.remote, settings.server]);
  const s = connected && connected.key === key ? connected.s : await connect(settings, url.origin);
  const address = url.pathname;
  // A sandbox started after the last listing, such as after the app restarted, lists again.
  if (!tracks.has(address)) {
    const sections = await sectionsOf(s, settings.libraries);
    const found = [];
    for (const section of sections) found.push(...(await tracksOf(s, section)));
    filesOf(s, found);
  }
  // Only a track this add-on listed; saved through whichever of the server's addresses answers.
  const ratingKey = tracks.get(address);
  if (!ratingKey) return { saved: false };
  const params = {
    key: ratingKey,
    identifier: LIBRARY,
    ...(report.finished
      ? {}
      : { time: String(Math.max(0, Math.round(report.positionMs))), state: 'stopped' }),
  };
  let response;
  try {
    response = await lelap.fetch(
      `${s.base}${report.finished ? '/:/scrobble' : '/:/progress'}?${queryOf(params)}`,
      { headers: plexHeaders(s.client, s.token) },
    );
  } catch (error) {
    // The next report looks for the server again.
    connected = null;
    throw error;
  }
  if (!response.ok) connected = null;
  if (response.status === 401 || response.status === 403) {
    throw new Error('The Plex server refused the sign-in. Sign in again.');
  }
  if (!response.ok) throw new Error(`The Plex server answered HTTP ${response.status}.`);
  return { saved: true };
}

addon({
  manifest: {
    id: 'app.lelap.plex',
    version: '1.0.0',
    protocol: 1,
    protocolVersion: 7,
    name: 'Plex',
    description:
      'Audiobooks in the music libraries of your Plex Media Server, played from the server itself. Places are kept with your Plex account.',
    types: ['audiobook'],
    resources: ['library', 'place', 'signin'],
    catalogs: [],
    sandbox: { hosts: ['plex.tv:443'] },
    settings: [
      {
        key: 'account',
        label: 'Plex account',
        type: 'signin',
        required: true,
        help: 'You enter a code at plex.tv/link. Lelap never sees your Plex password; the token stays on this device.',
      },
      {
        key: 'server',
        label: 'Server',
        type: 'text',
        help: 'The sign-in fills this in. To use another of your servers, enter its name and sign in again.',
      },
      {
        key: 'url',
        label: 'Address at home',
        type: 'url',
        host: true,
        help: 'The sign-in finds it: the server on your own network.',
      },
      {
        key: 'remote',
        label: 'Address away from home',
        type: 'url',
        host: true,
        help: 'The sign-in finds it when the server can be reached from the internet. Never a Plex relay: audio only comes from your server.',
      },
      {
        key: 'libraries',
        label: 'Libraries',
        type: 'text',
        placeholder: 'Audiobooks',
        help: 'The music libraries that hold your audiobooks, separated by commas. Every music library with “book” in its name when left empty.',
      },
    ],
  },
  library: (args) => library(args.settings || {}),
  place: (args) => place(args.settings || {}, args.place),
  signin: (args) =>
    args.id === 'start'
      ? signinStart(args.settings || {})
      : signinCheck(args.settings || {}, args.signin),
});
