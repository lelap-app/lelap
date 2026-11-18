/* global addon, lelap */
// Bundled with Lelap (M57): audiobooks in a folder that a web server lists, such as nginx with
// `autoindex on` (HTML or `autoindex_format json`), Apache's directory index, Caddy's
// `file_server browse` or `python3 -m http.server`. It runs in the app's sandbox and can reach
// only the address the listener enters. A login, when given, is sent as HTTP Basic.

const AUDIO = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const MAX_FOLDERS = 2000;
const MAX_FILES = 50000;

function basic(user, password) {
  // btoa takes bytes: UTF-8 first, so a name with ø or é works.
  const bytes = new TextEncoder().encode(user + ':' + password);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return 'Basic ' + btoa(binary);
}

function folderUrl(address) {
  const url = new URL(address);
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A direct child of `folder`: its name and whether it is a folder; null for anything else. */
function child(href, folder) {
  let url;
  try {
    url = new URL(href, folder);
  } catch {
    return null;
  }
  // Sort links (`?C=N;O=D`), other servers and the parent folder are not children.
  if (url.search || url.origin !== folder.origin) return null;
  if (!url.pathname.startsWith(folder.pathname) || url.pathname === folder.pathname) return null;
  const rest = url.pathname.slice(folder.pathname.length);
  const isFolder = rest.endsWith('/');
  const raw = isFolder ? rest.slice(0, -1) : rest;
  if (raw === '' || raw.includes('/')) return null;
  const name = decode(raw);
  if (name === '.' || name === '..' || name.includes('/')) return null;
  url.hash = '';
  return { url, name, folder: isFolder };
}

/** One folder's entries, from nginx's JSON listing or any HTML page of links. */
function entries(text, type, folder) {
  if (/json/i.test(type || '')) {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry) => {
      if (!entry || typeof entry.name !== 'string') return [];
      const isFolder = entry.type === 'directory';
      const href = encodeURIComponent(entry.name) + (isFolder ? '/' : '');
      const found = child(href, folder);
      if (!found) return [];
      const modified = Date.parse(entry.mtime || '');
      return [
        {
          ...found,
          size: Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : undefined,
          modifiedAt: Number.isFinite(modified) ? modified : undefined,
        },
      ];
    });
  }
  const out = [];
  const seen = new Set();
  for (const match of text.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (match[1] ?? match[2] ?? '').replace(/&amp;/g, '&');
    const found = child(href, folder);
    if (!found || seen.has(found.url.href)) continue;
    seen.add(found.url.href);
    out.push(found);
  }
  return out;
}

async function list(settings) {
  const root = folderUrl(settings.url);
  const headers = settings.user
    ? { Authorization: basic(settings.user, settings.password || '') }
    : {};
  const files = [];
  const queue = [{ url: root, path: '' }];
  const seen = new Set();
  while (queue.length > 0) {
    const { url, path } = queue.shift();
    if (seen.has(url.href) || seen.size >= MAX_FOLDERS) continue;
    seen.add(url.href);
    const response = await lelap.fetch(url.href, { headers });
    // A folder that can't be read fails the whole listing, so no book is marked missing for it.
    if (!response.ok)
      throw new Error(`The server answered HTTP ${response.status} for ${url.pathname}.`);
    const text = await response.text();
    for (const entry of entries(text, response.headers.get('content-type'), url)) {
      const entryPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.folder) {
        queue.push({ url: entry.url, path: entryPath });
      } else if ((AUDIO.test(entry.name) || IMAGE.test(entry.name)) && files.length < MAX_FILES) {
        files.push({
          path: entryPath,
          url: entry.url.href,
          ...(entry.size === undefined ? {} : { size: entry.size }),
          ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
        });
      }
    }
  }
  return { files, ...(headers.Authorization ? { headers } : {}) };
}

addon({
  manifest: {
    id: 'app.lelap.http-folder',
    version: '1.0.0',
    protocol: 1,
    protocolVersion: 5,
    name: 'HTTP folder',
    description:
      'Audiobooks in a folder a web server lists: nginx, Apache, Caddy or any server with directory listing on.',
    types: ['audiobook'],
    resources: ['library'],
    catalogs: [],
    sandbox: { hosts: [] },
    settings: [
      {
        key: 'url',
        label: 'Folder address',
        type: 'url',
        required: true,
        host: true,
        placeholder: 'http://192.168.1.20:8080/audiobooks/',
        help: 'The address that shows the folder’s list of files in a browser.',
      },
      {
        key: 'user',
        label: 'Username',
        type: 'text',
        help: 'Only if the server asks for a login.',
      },
      { key: 'password', label: 'Password', type: 'password' },
    ],
  },
  library: (args) => list(args.settings || {}),
});
