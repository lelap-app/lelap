/* global addon, lelap */
// Bundled with Lelap (M58): audiobooks on a server that speaks the Subsonic API, such as
// Navidrome, Airsonic-Advanced or Gonic. It runs in the app's sandbox and can reach only the
// address the listener enters.
//
// The login is Subsonic's token: `t` is the MD5 of the password and a fresh salt `s`, so the
// password itself never leaves the phone. Every API call gets a new salt, and goes as a form
// post when the server offers OpenSubsonic's `formPost`, which keeps the token out of the
// server's access logs. Audio can only carry the login in its address, so the token for streams
// and downloads goes back to the app as `query`: the app keeps it sealed and adds it to a file's
// address only when it plays, downloads or reads one, never to the address it stores.

const API = '1.16.1';
const CLIENT = 'lelap';
const PAGE = 500;
const MAX_PAGES = 200;
const MAX_FILES = 50000;
const PARALLEL = 6;
const AUDIO = new Set(['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav']);
const BY_TYPE = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/x-m4b': 'm4b',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

// What this server's sandbox learnt on its last listing: which songs have a bookmark, and whether
// the server takes form posts. Each server has a sandbox of its own, so nothing here is shared.
let known = new Set();
const formPost = new Map();

// MD5 (RFC 1321), which the Subsonic token needs; a worker has no MD5 of its own.
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
const R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array((((bytes.length + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[words.length - 2] = bytes.length * 8;
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let chunk = 0; chunk < words.length; chunk += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const shift = R[(i >> 4) * 4 + (i % 4)];
      const sum = (a + f + K[i] + words[chunk + g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  let hex = '';
  for (const word of [a0, b0, c0, d0]) {
    for (let j = 0; j < 4; j++) hex += ((word >>> (j * 8)) & 255).toString(16).padStart(2, '0');
  }
  return hex;
}

function randomSalt() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = encodeURIComponent;
const queryOf = (params) =>
  Object.entries(params)
    .map(([name, value]) => `${enc(name)}=${enc(value)}`)
    .join('&');

/** The server's base address with a trailing slash; a pasted `/rest` address works too. */
function serverBase(address) {
  const url = new URL(address);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/rest$/i, '') + '/';
  return url.href;
}

function session(settings) {
  const base = serverBase(settings.url);
  return {
    base,
    user: settings.user || '',
    password: settings.password || '',
    formPost: formPost.get(base) === true,
  };
}

/** A new token, with its own salt. */
function login(s) {
  const salt = randomSalt();
  return { u: s.user, t: md5(s.password + salt), s: salt };
}

function problem(error) {
  const code = error && error.code;
  if (code === 40) return 'The server refused the username or password.';
  if (code === 41) {
    return 'The server can’t check a token for this user (LDAP users, for one). Lelap only logs in with a token, so the password never leaves the phone.';
  }
  if (code === 50) return 'This user may not do that on the server.';
  if (code === 20 || code === 30)
    return 'The server’s Subsonic API is too old or too new for Lelap.';
  return `The server said: ${(error && error.message) || `error ${code}`}.`;
}

// Errors name the problem, never an address: an address could carry the token.
async function answer(response) {
  if (!response.ok) throw new Error(`The server answered HTTP ${response.status}.`);
  let body;
  try {
    body = JSON.parse(await response.text());
  } catch {
    throw new Error('This is not a Subsonic server: it did not answer in JSON.');
  }
  const reply = body && body['subsonic-response'];
  if (!reply || typeof reply !== 'object') throw new Error('This is not a Subsonic server.');
  if (reply.status !== 'ok') {
    const error = new Error(problem(reply.error));
    error.code = reply.error && reply.error.code;
    throw error;
  }
  return reply;
}

async function api(s, method, params = {}) {
  const query = queryOf({ ...login(s), v: API, c: CLIENT, f: 'json', ...params });
  const address = `${s.base}rest/${method}`;
  const response = s.formPost
    ? await lelap.fetch(address, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: query,
      })
    : await lelap.fetch(`${address}?${query}`);
  return answer(response);
}

/** OpenSubsonic's extensions, which need no login; none on a server without them. */
async function extensions(s) {
  try {
    const response = await lelap.fetch(
      `${s.base}rest/getOpenSubsonicExtensions?${queryOf({ v: API, c: CLIENT, f: 'json' })}`,
    );
    const reply = await answer(response);
    return new Set(list(reply.openSubsonicExtensions).map((e) => e && e.name));
  } catch {
    return new Set();
  }
}

// Older servers turn a list of one into the element itself.
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);

async function folderId(s, name) {
  const reply = await api(s, 'getMusicFolders');
  const folders = list(reply.musicFolders && reply.musicFolders.musicFolder);
  const wanted = name.trim().toLowerCase();
  const found = folders.find(
    (f) => String(f.name).trim().toLowerCase() === wanted || String(f.id) === name.trim(),
  );
  if (!found) {
    const names = folders.map((f) => `“${f.name}”`).join(', ') || 'none';
    throw new Error(`The server has no music folder called “${name.trim()}”. It has ${names}.`);
  }
  return String(found.id);
}

async function songsByGenre(s, genre, folder) {
  const songs = [];
  for (let page = 0; page < MAX_PAGES && songs.length < MAX_FILES; page++) {
    const reply = await api(s, 'getSongsByGenre', {
      genre,
      count: String(PAGE),
      offset: String(page * PAGE),
      ...(folder ? { musicFolderId: folder } : {}),
    });
    const found = list(reply.songsByGenre && reply.songsByGenre.song);
    songs.push(...found);
    if (found.length < PAGE) break;
  }
  return songs;
}

async function songsInFolder(s, folder) {
  const albums = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const reply = await api(s, 'getAlbumList2', {
      type: 'alphabeticalByName',
      size: String(PAGE),
      offset: String(page * PAGE),
      musicFolderId: folder,
    });
    const found = list(reply.albumList2 && reply.albumList2.album);
    albums.push(...found);
    if (found.length < PAGE) break;
  }
  const songs = [];
  let next = 0;
  // A few albums at a time: quicker than one by one, gentle on a small server.
  const worker = async () => {
    while (next < albums.length && songs.length < MAX_FILES) {
      const album = albums[next++];
      const reply = await api(s, 'getAlbum', { id: album.id });
      songs.push(...list(reply.album && reply.album.song));
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return songs;
}

/** Bookmarks by song ID; none when the server keeps none or doesn't have them. */
async function bookmarks(s) {
  try {
    const reply = await api(s, 'getBookmarks');
    const marks = new Map();
    for (const mark of list(reply.bookmarks && reply.bookmarks.bookmark)) {
      const id = mark && mark.entry && mark.entry.id;
      const at = Date.parse(mark.changed || mark.created || '');
      const position = Math.round(Number(mark.position));
      if (!id || !Number.isFinite(at) || at < 0 || !(position >= 0)) continue;
      marks.set(String(id), { positionMs: position, at });
    }
    return marks;
  } catch {
    return new Map();
  }
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

function suffixOf(song) {
  const suffix = String(song.suffix || '').toLowerCase();
  if (AUDIO.has(suffix)) return suffix;
  return BY_TYPE[String(song.contentType || '').toLowerCase()] || null;
}

const authorOf = (song) =>
  song.displayAlbumArtist ||
  list(song.albumArtists)
    .map((a) => a && a.name)
    .filter(Boolean)
    .join(', ') ||
  song.albumArtist ||
  song.artist ||
  '';

// ISBNs and ASINs only where a comment names them, such as `ASIN: B0…`; the app checks them.
function idsOf(song) {
  const ids = [];
  const text = String(song.comment || '');
  for (const match of text.matchAll(
    /\b(ISBN|ASIN)(?:-1[03])?\s*[:=]?\s*([0-9Xx-]{10,17}|[A-Z0-9]{10})\b/g,
  )) {
    ids.push(`${match[1].toLowerCase()}:${match[2]}`);
  }
  return ids.slice(0, 4);
}

// A changed cover gets a new ID on most servers; its hash stands in for a time, so the app
// fetches the cover again when it changes.
function stamp(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const fileAddress = (s, method, params) =>
  `${s.base}rest/${method}?${queryOf({ ...params, v: API, c: CLIENT })}`;

/**
 * Each album is a book, in a folder named after its author and title. The first file of a book
 * has no tags here, so the app reads that one itself: Subsonic servers don't give chapters or
 * ISBN and ASIN tags, and a single-file book often carries both.
 */
function filesOf(s, songs, marks) {
  const albums = new Map();
  const seen = new Set();
  for (const song of songs) {
    if (!song || song.isDir || !song.id || seen.has(String(song.id))) continue;
    if (song.type === 'video' || song.type === 'podcast') continue;
    seen.add(String(song.id));
    const key = String(song.albumId || song.parent || `${song.album}|${authorOf(song)}`);
    if (!albums.has(key)) albums.set(key, []);
    albums.get(key).push(song);
  }
  const files = [];
  const folders = new Set();
  for (const key of [...albums.keys()].sort()) {
    const tracks = albums
      .get(key)
      .sort(
        (a, b) =>
          (a.discNumber || 1) - (b.discNumber || 1) ||
          (a.track || 0) - (b.track || 0) ||
          String(a.title || '').localeCompare(String(b.title || '')) ||
          String(a.id).localeCompare(String(b.id)),
      );
    const first = tracks[0];
    const author = authorOf(first);
    const title = first.album || first.title || '';
    let folder = `${clean(author, 'Unknown author')}/${clean(title, 'Untitled')}`;
    // Two books by one author with one title stay apart.
    if (folders.has(folder.toLowerCase())) folder += ` (${clean(key, 'book')})`;
    folders.add(folder.toLowerCase());

    tracks.forEach((song, i) => {
      const suffix = suffixOf(song);
      if (!suffix || files.length >= MAX_FILES) return;
      const number = String(i + 1).padStart(3, '0');
      const name = song.title ? `${number} ${clean(song.title, '')}` : number;
      const modified = Date.parse(song.created || '');
      const seconds = Number(song.duration);
      const place = marks.get(String(song.id));
      const ids = idsOf(song);
      files.push({
        path: `${folder}/${name}.${suffix}`,
        // `raw`: the file as it is, which seeks and downloads like any file.
        url: fileAddress(s, 'stream', { id: song.id, format: 'raw' }),
        downloadUrl: fileAddress(s, 'download', { id: song.id }),
        ...(Number.isSafeInteger(song.size) && song.size >= 0 ? { size: song.size } : {}),
        ...(Number.isFinite(modified) && modified >= 0 ? { modifiedAt: modified } : {}),
        ...(i > 0 && Number.isFinite(seconds) && seconds >= 0
          ? {
              durationMs: Math.round(seconds * 1000),
              title: song.title || undefined,
              album: song.album || undefined,
              artist: song.artist || undefined,
              albumArtist: author || undefined,
              ...(ids.length > 0 ? { ids } : {}),
            }
          : {}),
        ...(place ? { place } : {}),
      });
    });
    if (first.coverArt && files.length < MAX_FILES) {
      files.push({
        path: `${folder}/cover.jpg`,
        url: fileAddress(s, 'getCoverArt', { id: first.coverArt, size: '1200' }),
        modifiedAt: stamp(String(first.coverArt)),
      });
    }
  }
  return files;
}

async function library(settings) {
  const s = session(settings);
  s.formPost = (await extensions(s)).has('formPost');
  formPost.set(s.base, s.formPost);
  // The login first, so a wrong password says so before anything else.
  await api(s, 'ping');
  const folder = settings.folder ? await folderId(s, settings.folder) : null;
  const genre = (settings.genre || '').trim() || (folder ? '' : 'Audiobook');
  const songs = genre ? await songsByGenre(s, genre, folder) : await songsInFolder(s, folder);
  const marks = await bookmarks(s);
  known = new Set(marks.keys());
  return { files: filesOf(s, songs, marks), query: login(s) };
}

const songId = (address) => {
  try {
    return new URL(address).searchParams.get('id');
  } catch {
    return null;
  }
};

/** Saves the listener's place as the server's bookmark, and clears the book's older ones. */
async function place(settings, report) {
  const s = session(settings);
  const id = songId(report.file.url);
  if (!id) return { saved: false };
  // A sandbox started after the last listing, such as after the app restarted, asks again.
  if (!formPost.has(s.base)) {
    s.formPost = (await extensions(s)).has('formPost');
    formPost.set(s.base, s.formPost);
  }
  if (report.finished) {
    await api(s, 'deleteBookmark', { id });
    known.delete(id);
  } else {
    await api(s, 'createBookmark', {
      id,
      position: String(Math.max(0, Math.round(report.positionMs))),
      comment: 'Lelap',
    });
    known.add(id);
  }
  for (const other of report.files) {
    const otherId = songId(other.url);
    if (!otherId || otherId === id || !known.has(otherId)) continue;
    await api(s, 'deleteBookmark', { id: otherId }).catch(() => {});
    known.delete(otherId);
  }
  return { saved: true };
}

addon({
  manifest: {
    id: 'app.lelap.subsonic',
    version: '1.0.0',
    protocol: 1,
    protocolVersion: 6,
    name: 'Subsonic',
    description:
      'Audiobooks on Navidrome, Airsonic-Advanced, Gonic or any server that speaks the Subsonic API. Places are kept with the server’s bookmarks.',
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
        placeholder: 'http://192.168.1.20:4533',
        help: 'The address of the server’s web page.',
      },
      { key: 'user', label: 'Username', type: 'text', required: true },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        required: true,
        help: 'Stays on this phone. The server only gets a token made from it.',
      },
      {
        key: 'folder',
        label: 'Music folder',
        type: 'text',
        placeholder: 'Audiobooks',
        help: 'A music folder or library on the server that holds your audiobooks. Every album in it is a book.',
      },
      {
        key: 'genre',
        label: 'Genre',
        type: 'text',
        placeholder: 'Audiobook',
        help: 'Albums with this genre are books; with a music folder, only those in it. Without a music folder, Audiobook when left empty.',
      },
    ],
  },
  library: (args) => library(args.settings || {}),
  place: (args) => place(args.settings || {}, args.place),
});
