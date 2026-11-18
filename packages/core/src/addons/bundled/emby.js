/* global addon, lelap */
// Bundled with Lelap (M59): audiobooks on an Emby server. It runs in the app's sandbox and can
// reach only the address the listener enters.
//
// It signs in with the username and password (or uses an API key) and hands the app the server's
// access token as a header for streams and downloads, sealed on the phone and sent only to this
// server. A browser's audio element can't send headers, so the web app puts the token in the
// address instead (`webQuery`). The mapping of items to books follows the app's own Jellyfin
// source (`packages/core/src/remote/jellyfin.ts`), whose API Emby shares.

const CLIENT = 'Lelap';
const VERSION = '1.0.0';
const TICKS_PER_MS = 10000;
const PAGE = 500;
const MAX_PAGES = 200;
const MAX_FILES = 50000;
const AUDIO = new Set(['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav']);
const BY_CONTAINER = { mp4: 'm4b', mpeg: 'mp3', oga: 'ogg', webma: 'opus' };
// Library kinds that hold books unless the listener names others.
const BOOK_KINDS = new Set(['audiobooks', 'books']);

// Tokens by server, user and login, for this server's sandbox only. Emby hands out the same
// token again to the same device, so a new sandbox signing in again changes nothing.
const signedIn = new Map();

const enc = encodeURIComponent;

// FNV-1a, for a device ID that stays the same for one server and user, and for cover stamps.
function hash(text) {
  let h = 0x811c9dc5;
  for (const char of text) {
    h ^= char.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The server's API base: `…/emby`, from the address of its web page or of the API. */
function serverBase(address) {
  const url = new URL(address);
  url.search = '';
  url.hash = '';
  const path = url.pathname
    .replace(/\/web(\/.*)?$/i, '')
    .replace(/\/+$/, '')
    .replace(/\/emby$/i, '');
  return `${url.origin}${path}/emby`;
}

function session(settings) {
  const base = serverBase(settings.url);
  const user = (settings.user || '').trim();
  return {
    base,
    user,
    password: settings.password || '',
    apiKey: (settings.apiKey || '').trim(),
    deviceId: `lelap-${hash(`${base}\n${user.toLowerCase()}`).toString(16)}`,
  };
}

const quoted = (value) => `"${String(value).replace(/["\\,]/g, '_')}"`;

function headersOf(s, token) {
  return {
    Accept: 'application/json',
    'X-Emby-Authorization': `Emby UserId="", Client=${quoted(CLIENT)}, Device=${quoted(CLIENT)}, DeviceId=${quoted(s.deviceId)}, Version=${quoted(VERSION)}`,
    ...(token ? { 'X-Emby-Token': token } : {}),
  };
}

// Errors name the problem, never an address: an address could carry the token.
async function call(s, token, path, { method = 'GET', query, body } = {}) {
  const search = query
    ? `?${Object.entries(query)
        .map(([k, v]) => `${enc(k)}=${enc(v)}`)
        .join('&')}`
    : '';
  const response = await lelap.fetch(`${s.base}${path}${search}`, {
    method,
    headers: {
      ...headersOf(s, token),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      s.apiKey
        ? 'Emby refused the API key.'
        : 'Emby refused the username or password, or this user may not do that.',
    );
  }
  if (!response.ok) throw new Error(`The Emby server answered HTTP ${response.status}.`);
  if (response.status === 204) return null;
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('This is not an Emby server: it did not answer in JSON.');
  }
}

const list = (value) => (Array.isArray(value) ? value : []);

const loginKey = (s) => `${s.base}\n${s.user}\n${hash(`${s.password}\n${s.apiKey}`)}`;

/** The user's ID and a token, from the password or the API key; `fresh` signs in again. */
async function signIn(s, fresh = false) {
  const key = loginKey(s);
  const known = signedIn.get(key);
  if (known && !fresh) return known;
  let found;
  if (s.apiKey) {
    // An API key is no user's, so the user is found by name.
    const users = list(await call(s, s.apiKey, '/Users'));
    const user = users.find(
      (u) => u && String(u.Name || '').toLowerCase() === s.user.toLowerCase(),
    );
    if (!user) throw new Error(`The Emby server has no user called “${s.user}”.`);
    found = { userId: String(user.Id), token: s.apiKey };
  } else {
    const reply = await call(s, '', '/Users/AuthenticateByName', {
      method: 'POST',
      body: { Username: s.user, Pw: s.password },
    });
    if (!reply || typeof reply.AccessToken !== 'string' || !reply.User || !reply.User.Id) {
      throw new Error('That address does not answer like Emby.');
    }
    found = { userId: String(reply.User.Id), token: reply.AccessToken };
  }
  signedIn.set(key, found);
  return found;
}

/** The libraries to take books from: those named in settings, or every book library. */
async function librariesOf(s, login, names) {
  const reply = await call(s, login.token, `/Users/${enc(login.userId)}/Views`);
  const views = list(reply && reply.Items).filter((v) => v && v.Id);
  const wanted = String(names || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  if (wanted.length === 0) {
    const books = views.filter((v) => BOOK_KINDS.has(String(v.CollectionType || '')));
    if (books.length === 0) {
      const all = views.map((v) => `“${v.Name}”`).join(', ') || 'none';
      throw new Error(
        `The Emby server has no audiobook library for this user. Name the libraries to use under Libraries; it has ${all}.`,
      );
    }
    return books;
  }
  return wanted.map((name) => {
    const view = views.find(
      (v) =>
        String(v.Name || '')
          .trim()
          .toLowerCase() === name.toLowerCase(),
    );
    if (!view) {
      const all = views.map((v) => `“${v.Name}”`).join(', ') || 'none';
      throw new Error(
        `The Emby server has no library called “${name}” for this user. It has ${all}.`,
      );
    }
    return view;
  });
}

// Emby leaves out when an item was last played unless asked for it.
const FIELDS =
  'Path,Chapters,People,DateCreated,ParentId,ProviderIds,Size,Container,UserDataLastPlayedDate';

/** One listing of a library in pages, in the given order; and how many items Emby counted. */
async function pagesOf(s, login, library, sortBy) {
  const items = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES && items.length < MAX_FILES; page++) {
    const reply = await call(s, login.token, `/Users/${enc(login.userId)}/Items`, {
      query: {
        ParentId: library.Id,
        Recursive: 'true',
        IncludeItemTypes: 'Audio,AudioBook',
        Fields: FIELDS,
        EnableUserData: 'true',
        SortBy: sortBy,
        StartIndex: String(page * PAGE),
        Limit: String(PAGE),
      },
    });
    const found = list(reply && reply.Items);
    items.push(...found);
    total = Number(reply && reply.TotalRecordCount) || 0;
    if (found.length < PAGE || items.length >= total) break;
  }
  return { items, total };
}

const uniqueCount = (items) => new Set(items.map((i) => i && i.Id)).size;

/**
 * Every item of a library. Items with the same name may swap places between pages, so one can
 * show twice and another not at all; when fewer items came than Emby counted, a second listing in
 * the order they were added fills the gaps. Repeats are dropped later.
 */
async function itemsOf(s, login, library) {
  const first = await pagesOf(s, login, library, 'SortName');
  if (uniqueCount(first.items) >= first.total || first.items.length >= MAX_FILES) {
    return first.items;
  }
  const second = await pagesOf(s, login, library, 'DateCreated,SortName');
  return [...first.items, ...second.items];
}

/** Which of these folders have a picture of their own: a cover.jpg in an audiobook folder. */
async function folderPictures(s, login, ids) {
  const tags = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const reply = await call(s, login.token, `/Users/${enc(login.userId)}/Items`, {
      query: { Ids: ids.slice(i, i + 50).join(','), Fields: 'ImageTags' },
    });
    for (const item of list(reply && reply.Items)) {
      const tag = item && item.ImageTags && item.ImageTags.Primary;
      if (tag) tags.set(String(item.Id), String(tag));
    }
  }
  return tags;
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

const segment = (path, from = 1) => {
  const parts = String(path || '')
    .split(/[\\/]/)
    .filter(Boolean);
  return parts[parts.length - from] || null;
};

function suffixOf(item) {
  const name = segment(item.Path) || '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (AUDIO.has(ext)) return ext;
  for (const part of String(item.Container || '').split(',')) {
    const c = part.trim().toLowerCase();
    if (AUDIO.has(c)) return c;
    if (BY_CONTAINER[c]) return BY_CONTAINER[c];
  }
  return null;
}

const peopleOf = (item, types) =>
  list(item.People)
    .filter((p) => p && p.Name && types.includes(p.Type || ''))
    .map((p) => p.Name);

function authorOf(item) {
  const authors = peopleOf(item, ['Author', 'Writer']);
  if (authors.length > 0) return authors.join(', ');
  return item.AlbumArtist || list(item.Artists)[0] || '';
}

// ISBNs and ASINs among the provider IDs; the Audible plugins keep the ASIN as `Audible`. The app
// checks them.
function idsOf(item) {
  const ids = [];
  for (const [key, value] of Object.entries(item.ProviderIds || {})) {
    const name = key.toLowerCase();
    if (!value) continue;
    if (name === 'isbn' || name === 'isbn13' || name === 'isbn10') ids.push(`isbn:${value}`);
    else if (name === 'asin' || name === 'audible') ids.push(`asin:${value}`);
  }
  return ids.slice(0, 4);
}

const msOf = (ticks) => Math.max(0, Math.round((Number(ticks) || 0) / TICKS_PER_MS));

/** The listener's place in an item as Emby keeps it; null when there is none. */
function placeOf(item) {
  const data = item.UserData;
  if (!data) return null;
  const position = msOf(data.PlaybackPositionTicks);
  if (!data.Played && position <= 0) return null;
  const at = Date.parse(data.LastPlayedDate || '');
  return {
    positionMs: position,
    at: Number.isFinite(at) && at > 0 ? at : 0,
    ...(data.Played ? { played: true } : {}),
  };
}

/**
 * Each album, or each folder without one, is a book in a folder named after its author and title,
 * its parts in disc and track order. Emby has already read every file's tags and chapters, so
 * they come along and the app reads none of the files itself.
 */
function filesOf(s, items, pictures) {
  const books = new Map();
  const seen = new Set();
  for (const item of items) {
    if (!item || !item.Id || item.IsFolder || seen.has(String(item.Id))) continue;
    seen.add(String(item.Id));
    const key = String(item.AlbumId || item.ParentId || item.Id);
    if (!books.has(key)) books.set(key, []);
    books.get(key).push(item);
  }
  const files = [];
  const folders = new Set();
  for (const key of [...books.keys()].sort()) {
    const parts = books
      .get(key)
      .sort(
        (a, b) =>
          (a.ParentIndexNumber || 1) - (b.ParentIndexNumber || 1) ||
          (a.IndexNumber || 0) - (b.IndexNumber || 0) ||
          String(segment(a.Path) || a.Name || '').localeCompare(
            String(segment(b.Path) || b.Name || ''),
          ) ||
          String(a.Id).localeCompare(String(b.Id)),
      );
    const first = parts[0];
    const author = authorOf(first);
    const title = first.Album || segment(first.Path, 2) || first.Name || '';
    let folder = `${clean(author, 'Unknown author')}/${clean(title, 'Untitled')}`;
    // Two books by one author with one title stay apart.
    if (folders.has(folder.toLowerCase())) folder += ` (${clean(key, 'book')})`;
    folders.add(folder.toLowerCase());

    parts.forEach((item, i) => {
      const suffix = suffixOf(item);
      if (!suffix || files.length >= MAX_FILES) return;
      const number = String(i + 1).padStart(3, '0');
      const name = item.Name ? `${number} ${clean(item.Name, '')}` : number;
      const created = Date.parse(item.DateCreated || '');
      const place = placeOf(item);
      const ids = idsOf(item);
      const chapters = list(item.Chapters)
        .filter((c) => c && c.MarkerType !== 'IntroStart' && c.MarkerType !== 'IntroEnd')
        .map((c, n) => ({
          title: String(c.Name || '').trim() || `Chapter ${n + 1}`,
          startMs: msOf(c.StartPositionTicks),
        }));
      const id = enc(item.Id);
      files.push({
        path: `${folder}/${name}.${suffix}`,
        // `static`: the file as it is, never transcoded, so it seeks and downloads like any file.
        url: `${s.base}/Audio/${id}/stream?static=true`,
        downloadUrl: `${s.base}/Items/${id}/Download`,
        ...(Number.isSafeInteger(item.Size) && item.Size >= 0 ? { size: item.Size } : {}),
        ...(Number.isFinite(created) && created >= 0 ? { modifiedAt: created } : {}),
        // Without a length from Emby, the app reads the file's tags itself.
        ...(msOf(item.RunTimeTicks) > 0
          ? {
              durationMs: msOf(item.RunTimeTicks),
              title: item.Name || undefined,
              album: title || undefined,
              artist: list(item.Artists).join(', ') || undefined,
              albumArtist: author || undefined,
              ...(chapters.length > 0 ? { chapters } : {}),
              ...(ids.length > 0 ? { ids } : {}),
            }
          : {}),
        ...(place ? { place } : {}),
      });
    });
    // The first part's own picture, its album's, or its folder's.
    const cover =
      first.ImageTags && first.ImageTags.Primary
        ? [first.Id, first.ImageTags.Primary]
        : first.AlbumId && first.AlbumPrimaryImageTag
          ? [first.AlbumId, first.AlbumPrimaryImageTag]
          : first.ParentId && pictures.has(String(first.ParentId))
            ? [first.ParentId, pictures.get(String(first.ParentId))]
            : null;
    if (cover && files.length < MAX_FILES) {
      files.push({
        path: `${folder}/cover.jpg`,
        url: `${s.base}/Items/${enc(cover[0])}/Images/Primary?maxHeight=1200&tag=${enc(cover[1])}`,
        // A changed picture gets a new tag; its hash stands in for a time.
        modifiedAt: hash(String(cover[1])),
      });
    }
  }
  return files;
}

async function library(settings) {
  const s = session(settings);
  if (!s.password && !s.apiKey) throw new Error('Enter the password or an API key.');
  // Each listing signs in again, so a token the server dropped is replaced.
  const login = await signIn(s, true);
  const libraries = await librariesOf(s, login, settings.libraries);
  const items = [];
  for (const view of libraries) items.push(...(await itemsOf(s, login, view)));
  const parents = [
    ...new Set(
      items
        .filter((i) => i && !(i.ImageTags && i.ImageTags.Primary) && !i.AlbumPrimaryImageTag)
        .map((i) => i.ParentId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const pictures = await folderPictures(s, login, parents);
  return {
    files: filesOf(s, items, pictures),
    headers: { 'X-Emby-Token': login.token },
    webQuery: { api_key: login.token },
  };
}

const itemId = (address) => {
  try {
    const match = /\/Audio\/([^/]+)\/stream$/.exec(new URL(address).pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
};

/** Saves the listener's place as the user's data for the item: where, and when. */
async function place(settings, report) {
  const s = session(settings);
  const id = itemId(report.file.url);
  if (!id || (!s.password && !s.apiKey)) return { saved: false };
  const login = await signIn(s);
  const when = new Date(report.at).toISOString();
  try {
    await call(s, login.token, `/Users/${enc(login.userId)}/Items/${enc(id)}/UserData`, {
      method: 'POST',
      body: report.finished
        ? { Played: true, PlaybackPositionTicks: 0, LastPlayedDate: when }
        : {
            Played: false,
            PlaybackPositionTicks: Math.max(0, Math.round(report.positionMs)) * TICKS_PER_MS,
            LastPlayedDate: when,
          },
    });
  } catch (error) {
    // A token the server dropped is asked for again next time.
    signedIn.delete(loginKey(s));
    throw error;
  }
  return { saved: true };
}

addon({
  manifest: {
    id: 'app.lelap.emby',
    version: '1.0.0',
    protocol: 1,
    protocolVersion: 7,
    name: 'Emby',
    description:
      'Audiobooks on an Emby server, played as the original files. Places are kept with the Emby user.',
    types: ['audiobook'],
    resources: ['library', 'place'],
    catalogs: [],
    sandbox: { hosts: [] },
    settings: [
      {
        key: 'url',
        label: 'Server address',
        type: 'url',
        required: true,
        host: true,
        placeholder: 'http://192.168.1.20:8096',
        help: 'The address you open Emby at.',
      },
      { key: 'user', label: 'Username', type: 'text', required: true },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        help: 'Stays on this phone. Lelap signs in with it and plays with the token Emby gives back.',
      },
      {
        key: 'apiKey',
        label: 'API key',
        type: 'password',
        help: 'Instead of the password: made in Emby under Settings → API Keys. A key reaches every user’s library, so the password is the better choice.',
      },
      {
        key: 'libraries',
        label: 'Libraries',
        type: 'text',
        placeholder: 'Audiobooks',
        help: 'The libraries to take books from, separated by commas. Every audiobook and book library when left empty.',
      },
    ],
  },
  library: (args) => library(args.settings || {}),
  place: (args) => place(args.settings || {}, args.place),
});
