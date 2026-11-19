/* global addon, lelap */
// Bundled with Lelap (M128): the audiobooks in an OPDS catalog, such as a Calibre content server
// at home or a library's open catalog. Reads OPDS 1.2 (Atom) and OPDS 2.0 (JSON). It runs in the
// app's sandbox and can reach only the address the listener enters.
//
// The scan starts at that address, follows navigation and `next` links on the same server and
// keeps each publication with an audio file or a Readium audiobook manifest; ebooks are left out.
// It goes a few dozen feeds per call and hands the app a cursor (revision 9), so a big catalog
// never runs into the app's time limit for one call. A login goes as HTTP Basic.

const MAX_PAGES = 2000;
const MAX_BOOKS = 10000;
const PAGES_PER_CALL = 40;
// The first call stays short: adding a server checks the login with it.
const FIRST_CALL_PAGES = 4;
const ACCEPT =
  'application/opds+json, application/atom+xml;profile=opds-catalog;q=0.9, application/json;q=0.5, */*;q=0.1';

const AUDIO = new Set(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'oga', 'aac', 'flac', 'wav']);
// Which format of a book to play when it has several: one file before many, small before large.
const PREFERRED = ['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'oga', 'aac', 'flac', 'wav'];
const BY_TYPE = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4b': 'm4b',
  'audio/x-m4b': 'm4b',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'application/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};
const AUDIOBOOK_MANIFEST = 'application/audiobook+json';
// Plain and open-access acquisition only: borrow, buy, subscribe and samples are never followed.
const ACQUIRE = new Set([
  'http://opds-spec.org/acquisition',
  'http://opds-spec.org/acquisition/open-access',
]);
const CRAWLABLE = 'http://opds-spec.org/crawlable';
const BASIC = 'http://opds-spec.org/auth/basic';
// Links that lead back up or sideways, never further down.
const NOT_DOWN = new Set(['self', 'start', 'up', 'first', 'last', 'previous', 'prev', 'search']);
// Calibre's root lists the same books by title, author, tag, series and more; its “By Title”
// feed (`navcatalog/` + hex of `Otitle`) alone holds every book.
const CALIBRE_TITLE = '/navcatalog/4f7469746c65';

// Scans in progress in this server's sandbox, by cursor. A sandbox started afresh knows none.
const scans = new Map();

function basic(user, password) {
  // btoa takes bytes: UTF-8 first, so a name with ø or é works.
  const bytes = new TextEncoder().encode(user + ':' + password);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return 'Basic ' + btoa(binary);
}

// FNV-1a, for cursors and cover stamps.
function hash(text) {
  let h = 0x811c9dc5;
  for (const char of text) {
    h ^= char.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// --- XML -------------------------------------------------------------------------------------
// A worker has no DOMParser. Atom feeds need little: elements by local name, their attributes
// and their text. Namespaces are dropped, so `atom:link` and `link` read alike.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

function unescapeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const localName = (name) => name.slice(name.indexOf(':') + 1);

function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  const attr = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.text += unescapeXml(text.slice(i));
      break;
    }
    if (lt > i) top.text += unescapeXml(text.slice(i, lt));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? text.length : end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      top.text += text.slice(lt + 9, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + 3;
    } else if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      i = end < 0 ? text.length : end + 1;
    } else {
      tag.lastIndex = lt;
      const m = tag.exec(text);
      if (!m) {
        top.text += '<';
        i = lt + 1;
        continue;
      }
      i = tag.lastIndex;
      const name = localName(m[2]);
      if (m[1]) {
        // Close up to the matching element; a stray closing tag is ignored.
        for (let at = stack.length - 1; at > 0; at--) {
          if (stack[at].name === name) {
            stack.length = at;
            break;
          }
        }
        continue;
      }
      const attrs = {};
      for (const a of m[3].matchAll(attr)) attrs[localName(a[1])] = unescapeXml(a[2] ?? a[3]);
      const element = { name, attrs, children: [], text: '' };
      top.children.push(element);
      if (!m[4]) stack.push(element);
    }
  }
  return root;
}

const kids = (element, name) => element.children.filter((c) => c.name === name);
const kid = (element, name) => element.children.find((c) => c.name === name) || null;

/** All text inside an element, such as an `xhtml` title. */
function textOf(element) {
  if (!element) return '';
  return (element.text + element.children.map(textOf).join(' ')).replace(/\s+/g, ' ').trim();
}

/** An Atom text construct: plain, or HTML as escaped text, which loses its tags here. */
function atomText(element) {
  if (!element) return '';
  const text = textOf(element);
  return element.attrs.type === 'html'
    ? unescapeXml(text.replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
    : text;
}

// --- Feeds -----------------------------------------------------------------------------------

/** A link as both formats have it. */
const linkOf = (href, rel, type, extra = {}) => ({
  href: String(href || ''),
  rels: String(rel || '')
    .split(/\s+/)
    .filter(Boolean),
  type: String(type || '').toLowerCase(),
  ...extra,
});

const isAtomFeed = (type) => /application\/atom\+xml/.test(type) && !/type=entry/.test(type);

function isbnsOf(values) {
  const ids = [];
  for (const value of values) {
    const match = /^urn:isbn:([0-9xX-]{10,17})$/i.exec(String(value || '').trim());
    if (match) ids.push(`isbn:${match[1].replace(/-/g, '')}`);
  }
  return [...new Set(ids)].slice(0, 4);
}

class NotFeed extends Error {}

function atomFeed(text) {
  const doc = parseXml(text);
  const feed = kid(doc, 'feed');
  if (!feed) {
    // An entry document on its own is one publication.
    const entry = kid(doc, 'entry');
    if (entry) return { id: '', links: [], navigation: [], publications: [atomEntry(entry)] };
    throw new NotFeed(
      'This address is not an OPDS feed. For Calibre’s content server, add /opds to its address.',
    );
  }
  const links = kids(feed, 'link').map((l) => linkOf(l.attrs.href, l.attrs.rel, l.attrs.type));
  const navigation = [];
  const publications = [];
  for (const entry of kids(feed, 'entry')) {
    const entryLinks = kids(entry, 'link').map((l) =>
      linkOf(l.attrs.href, l.attrs.rel, l.attrs.type),
    );
    const leadsOn = entryLinks.filter(
      (l) =>
        isAtomFeed(l.type) &&
        !l.rels.some((r) => NOT_DOWN.has(r) || r.startsWith('http://opds-spec.org/acquisition')),
    );
    const acquires = entryLinks.some((l) =>
      l.rels.some((r) => r.startsWith('http://opds-spec.org/acquisition')),
    );
    if (leadsOn.length > 0 && !acquires) navigation.push(...leadsOn);
    else publications.push(atomEntry(entry));
  }
  return { id: textOf(kid(feed, 'id')), links, navigation, publications };
}

function atomEntry(entry) {
  const links = kids(entry, 'link').map((l) =>
    linkOf(l.attrs.href, l.attrs.rel, l.attrs.type, {
      length: Number(l.attrs.length),
      // Calibre says when the file last changed.
      mtime: Date.parse(l.attrs.mtime || ''),
      indirect: kids(l, 'indirectAcquisition').length > 0,
    }),
  );
  const updated = Date.parse(textOf(kid(entry, 'updated')) || '');
  return {
    key: textOf(kid(entry, 'id')),
    title: atomText(kid(entry, 'title')),
    authors: kids(entry, 'author')
      .map((a) => textOf(kid(a, 'name')))
      .filter(Boolean),
    ids: isbnsOf([textOf(kid(entry, 'id')), ...kids(entry, 'identifier').map(textOf)]),
    updated: updated >= 0 ? updated : undefined,
    links,
  };
}

const asList = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

const nameOf = (contributor) =>
  typeof contributor === 'string'
    ? contributor
    : contributor && typeof contributor.name === 'string'
      ? contributor.name
      : contributor && contributor.name && typeof contributor.name === 'object'
        ? String(Object.values(contributor.name)[0] || '')
        : '';

const jsonLink = (l) =>
  linkOf(l && l.href, l && l.rel ? asList(l.rel).join(' ') : '', l && l.type, {
    title: l && typeof l.title === 'string' ? l.title : undefined,
    duration: l && Number(l.duration),
    width: l && Number(l.width),
    templated: !!(l && l.templated),
    indirect: !!(l && l.properties && l.properties.indirectAcquisition),
  });

function jsonPublication(p) {
  const metadata = (p && p.metadata) || {};
  const title =
    typeof metadata.title === 'string'
      ? metadata.title
      : metadata.title && typeof metadata.title === 'object'
        ? String(Object.values(metadata.title)[0] || '')
        : '';
  const modified = Date.parse(metadata.modified || '');
  return {
    key: String(metadata.identifier || ''),
    title,
    authors: asList(metadata.author).map(nameOf).filter(Boolean),
    ids: isbnsOf(asList(metadata.identifier)),
    updated: modified >= 0 ? modified : undefined,
    links: asList(p && p.links).map(jsonLink),
    images: asList(p && p.images).map(jsonLink),
    readingOrder: asList(p && p.readingOrder).map(jsonLink),
  };
}

function jsonFeed(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new NotFeed('This address is not an OPDS catalog: it did not answer in JSON or Atom.');
  }
  if (!body || typeof body !== 'object') throw new NotFeed('This address is not an OPDS catalog.');
  // A Readium audiobook manifest on its own is one publication.
  if (body.readingOrder && body.metadata) {
    return { id: '', links: [], navigation: [], publications: [jsonPublication(body)] };
  }
  const navigation = [];
  const publications = [];
  for (const part of [body, ...asList(body.groups)]) {
    if (!part || typeof part !== 'object') continue;
    for (const l of asList(part.navigation).map(jsonLink)) {
      const feedLike = l.type === '' || /json|atom\+xml/.test(l.type);
      if (feedLike && !l.templated && !l.rels.some((r) => NOT_DOWN.has(r))) navigation.push(l);
    }
    publications.push(...asList(part.publications).map(jsonPublication));
  }
  return { id: '', links: asList(body.links).map(jsonLink), navigation, publications };
}

// --- Fetching --------------------------------------------------------------------------------

/** Why the server would not show the feed, from its OPDS authentication document if it has one. */
function refusal(s, status, type, text) {
  let offered = null;
  if (/opds-authentication\+json/.test(type)) {
    try {
      offered = asList(JSON.parse(text).authentication)
        .map((a) => a && a.type)
        .filter(Boolean);
    } catch {
      offered = null;
    }
  }
  if (offered && offered.length > 0 && !offered.includes(BASIC)) {
    return new Error(
      'This catalog asks for a kind of login Lelap can’t do yet. Lelap signs in with a user name and password only.',
    );
  }
  if (!s.auth) return new Error('This catalog asks for a login. Enter the user name and password.');
  if (status === 403) return new Error('This user may not read the catalog.');
  return new Error('The catalog refused the user name or password.');
}

/**
 * A feed or manifest that is gone, moved or not a feed at all. Past the start address it is left
 * out; anything else, such as a server error, fails the scan so no book is marked missing.
 */
class Gone extends Error {}

async function get(s, url) {
  let response;
  try {
    response = await lelap.fetch(url, {
      headers: { Accept: ACCEPT, ...(s.auth ? { Authorization: s.auth } : {}) },
    });
  } catch (error) {
    const message = String((error && error.message) || error);
    throw /redirect/i.test(message) ? new Gone(message) : error;
  }
  const type = String((response.headers && response.headers.get('content-type')) || '');
  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw refusal(s, response.status, type.toLowerCase(), text);
  }
  // Calibre answers 400 to a Basic login when it takes Digest only, its default without https.
  if (response.status === 400 && s.auth) {
    throw new Error(
      'The server didn’t take the login. A Calibre content server needs its authentication mode set to Basic: in Calibre, Preferences → Sharing over the net → Advanced.',
    );
  }
  if (!response.ok) {
    const said = `The catalog answered HTTP ${response.status} for ${new URL(url).pathname}.`;
    throw response.status === 404 || response.status === 410 ? new Gone(said) : new Error(said);
  }
  return { type: type.toLowerCase(), text };
}

function parseFeed({ type, text }) {
  if (/json/.test(type)) return jsonFeed(text);
  if (/xml/.test(type)) return atomFeed(text);
  return text.trimStart().startsWith('{') ? jsonFeed(text) : atomFeed(text);
}

/** An address on the catalog's own server, without its fragment; null for anything else. */
function sameServer(href, base, origin) {
  try {
    const url = new URL(href, base);
    url.hash = '';
    return url.origin === origin ? url.href : null;
  } catch {
    return null;
  }
}

function absolute(href, base) {
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// --- Books -----------------------------------------------------------------------------------

/** The audio format of a link: its address's extension, Calibre's `/get/<format>/`, or its type. */
function formatOf(link, base) {
  const url = absolute(link.href, base);
  if (!url) return null;
  const path = new URL(url).pathname.toLowerCase();
  const ext = (/\.([a-z0-9]{2,4})$/.exec(path) || [])[1];
  if (ext && AUDIO.has(ext)) return ext;
  // Calibre's own mime types call an M4A `audio/mpeg`, so its address says more.
  const calibre = (/\/get\/([a-z0-9]+)\/\d+/.exec(path) || [])[1];
  if (calibre && AUDIO.has(calibre)) return calibre;
  const type = link.type.split(';')[0].trim();
  return BY_TYPE[type] || null;
}

const acquires = (link) => !link.indirect && link.rels.some((r) => ACQUIRE.has(r));

/** The parts to play: the best audio format's links in order, or null when there are none. */
function audioParts(p, base) {
  const byFormat = new Map();
  for (const link of p.links) {
    if (!acquires(link)) continue;
    const format = formatOf(link, base);
    if (!format) continue;
    if (!byFormat.has(format)) byFormat.set(format, []);
    byFormat.get(format).push(link);
  }
  const format = PREFERRED.find((f) => byFormat.has(f));
  if (!format) return null;
  return byFormat.get(format).map((link) => ({
    url: absolute(link.href, base),
    format,
    size: Number.isSafeInteger(link.length) && link.length >= 0 ? link.length : undefined,
    modifiedAt: Number.isFinite(link.mtime) && link.mtime >= 0 ? link.mtime : p.updated,
    title: link.title,
  }));
}

/** The parts of a Readium audiobook's reading order, with their lengths. */
function readingOrderParts(links, base, updated) {
  const parts = [];
  for (const link of links) {
    const url = absolute(link.href, base);
    const format = url && formatOf(link, base);
    if (!format) return null;
    parts.push({
      url,
      format,
      modifiedAt: updated,
      title: link.title,
      durationMs:
        Number.isFinite(link.duration) && link.duration >= 0
          ? Math.round(link.duration * 1000)
          : undefined,
    });
  }
  return parts.length > 0 ? parts : null;
}

const manifestLink = (p) =>
  p.links.find(
    (l) =>
      !l.indirect &&
      l.type.split(';')[0].trim() === AUDIOBOOK_MANIFEST &&
      (l.rels.length === 0 || l.rels.some((r) => ACQUIRE.has(r) || r === 'alternate')),
  );

function coverOf(p, base) {
  const images = p.images || [];
  if (images.length > 0) {
    const best = [...images].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return absolute(best.href, base);
  }
  const rel = (wanted) => p.links.find((l) => l.rels.includes(wanted));
  const link =
    rel('http://opds-spec.org/image') ||
    rel('http://opds-spec.org/cover') ||
    rel('http://opds-spec.org/image/thumbnail') ||
    rel('http://opds-spec.org/thumbnail');
  return link ? absolute(link.href, base) : null;
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

const IMAGE_EXT = { 'image/png': 'png', 'image/webp': 'webp' };

/** One book's files, in a folder named after its author and title, its cover last. */
function bookFiles(scan, p, parts, cover) {
  const author = p.authors.join(', ');
  let folder = `${clean(author, 'Unknown author')}/${clean(p.title, 'Untitled')}`;
  // Two books by one author with one title stay apart.
  let n = 2;
  while (scan.folders.has(folder.toLowerCase()))
    folder = folder.replace(/( \(\d+\))?$/, ` (${n++})`);
  scan.folders.add(folder.toLowerCase());
  const files = parts.map((part, i) => {
    const name =
      parts.length === 1
        ? clean(p.title, 'Book')
        : `${String(i + 1).padStart(3, '0')}${part.title ? ` ${clean(part.title, '')}` : ''}`;
    return {
      path: `${folder}/${name}.${part.format}`,
      url: part.url,
      ...(part.size === undefined ? {} : { size: part.size }),
      ...(part.modifiedAt === undefined ? {} : { modifiedAt: part.modifiedAt }),
      // The first part has no length here, so the app reads it, and its chapters, itself.
      ...(i > 0 && part.durationMs !== undefined ? { durationMs: part.durationMs } : {}),
      title: part.title || p.title || undefined,
      album: p.title || undefined,
      artist: author || undefined,
      albumArtist: author || undefined,
      ...(p.ids.length > 0 ? { ids: p.ids } : {}),
    };
  });
  if (cover) {
    const type = (p.images && p.images.length > 0 ? p.images : p.links).find(
      (l) => absolute(l.href, scan.base) === cover,
    );
    const ext = IMAGE_EXT[type ? type.type.split(';')[0].trim() : ''] || 'jpg';
    // A changed cover gets a new address on most servers; its hash stands in for a time.
    files.push({ path: `${folder}/cover.${ext}`, url: cover, modifiedAt: hash(cover) });
  }
  return files;
}

// --- The scan --------------------------------------------------------------------------------

function session(settings) {
  const start = new URL(settings.url);
  start.hash = '';
  const user = (settings.user || '').trim();
  return {
    start: start.href,
    origin: start.origin,
    auth: user ? basic(user, settings.password || '') : null,
  };
}

function newScan(s) {
  return {
    s,
    base: s.start,
    queue: [s.start],
    seen: new Set([s.start]),
    books: new Set(),
    folders: new Set(),
    pages: 0,
    count: 0,
  };
}

function tooBig(what) {
  return new Error(
    `This catalog is larger than Lelap reads: it stopped after ${what}. Enter the address of a narrower feed, such as one collection, one format or your audiobooks only.`,
  );
}

function fetchBudget(scan) {
  if (scan.pages >= MAX_PAGES) throw tooBig('2,000 pages');
  scan.pages++;
}

/** Calibre's root feed, where only its “By Title” feeds and its other libraries are followed. */
const isCalibreRoot = (feed) =>
  feed.id === 'urn:calibre:main' ||
  feed.navigation.some((l) => /\/opds\/navcatalog\/4f6e6577657374/.test(l.href));

function linksOn(scan, feed, url) {
  const crawlable = feed.links.find((l) => l.rels.includes(CRAWLABLE));
  let down = crawlable ? [crawlable] : feed.navigation;
  if (!crawlable && isCalibreRoot(feed)) {
    down = down.filter((l) => {
      const to = sameServer(l.href, url, scan.s.origin);
      if (!to) return false;
      const path = new URL(to).pathname;
      return path.includes(CALIBRE_TITLE) || /\/opds\/?$/.test(path);
    });
  }
  const next = feed.links.filter((l) => l.rels.includes('next'));
  const out = [];
  for (const link of [...next, ...down]) {
    const to = sameServer(link.href, url, scan.s.origin);
    if (to && !scan.seen.has(to)) {
      scan.seen.add(to);
      out.push(to);
    }
  }
  return out;
}

async function publicationFiles(scan, p, base) {
  if (!p.title && p.links.length === 0) return [];
  const key = p.key || `${p.title}\n${p.authors.join(', ')}`;
  if (scan.books.has(key)) return [];
  let parts = audioParts(p, base);
  if (!parts && p.readingOrder && p.readingOrder.length > 0) {
    parts = readingOrderParts(p.readingOrder, base, p.updated);
  }
  if (!parts) {
    const link = manifestLink(p);
    const at = link && sameServer(link.href, base, scan.s.origin);
    if (at) {
      fetchBudget(scan);
      let manifest = null;
      try {
        manifest = jsonPublication(JSON.parse((await get(scan.s, at)).text));
      } catch (error) {
        // A missing or broken manifest leaves out its book, not the whole catalog.
        if (!(error instanceof Gone) && !(error instanceof SyntaxError)) throw error;
      }
      if (manifest) {
        parts = readingOrderParts(manifest.readingOrder, at, p.updated);
        if (!p.title) p.title = manifest.title;
        if (p.authors.length === 0) p.authors = manifest.authors;
      }
    }
  }
  if (!parts) return [];
  scan.books.add(key);
  scan.count++;
  if (scan.count > MAX_BOOKS) throw tooBig('10,000 audiobooks');
  return bookFiles(scan, p, parts, coverOf(p, base));
}

async function library(settings, cursor) {
  let id = cursor;
  let scan = id ? scans.get(id) : null;
  if (id && !scan) throw new Error('The scan was interrupted. Scan the server again.');
  if (!scan) {
    scan = newScan(session(settings));
    id = `scan-${hash(`${scan.s.start}\n${Date.now()}\n${Math.random()}`).toString(36)}`;
    scans.set(id, scan);
  }
  const files = [];
  try {
    const pages = cursor ? PAGES_PER_CALL : FIRST_CALL_PAGES;
    for (let n = 0; n < pages && scan.queue.length > 0; n++) {
      const url = scan.queue.shift();
      fetchBudget(scan);
      let feed;
      try {
        feed = parseFeed(await get(scan.s, url));
      } catch (error) {
        if (url === scan.s.start || !(error instanceof Gone || error instanceof NotFeed))
          throw error;
        continue;
      }
      for (const p of feed.publications) files.push(...(await publicationFiles(scan, p, url)));
      scan.queue.unshift(...linksOn(scan, feed, url));
    }
  } catch (error) {
    scans.delete(id);
    throw error;
  }
  const done = scan.queue.length === 0;
  if (done) scans.delete(id);
  return {
    files,
    ...(scan.s.auth ? { headers: { Authorization: scan.s.auth } } : {}),
    ...(done ? {} : { next: id }),
  };
}

addon({
  manifest: {
    id: 'app.lelap.opds',
    version: '1.0.0',
    protocol: 1,
    protocolVersion: 9,
    name: 'OPDS',
    description:
      'The audiobooks in an OPDS catalog, such as a Calibre content server or a library’s open catalog. Ebooks are left out.',
    types: ['audiobook'],
    resources: ['library'],
    catalogs: [],
    sandbox: { hosts: [] },
    settings: [
      {
        key: 'url',
        label: 'Catalog address',
        type: 'url',
        required: true,
        host: true,
        placeholder: 'http://192.168.1.20:8080/opds',
        help: 'The address of the OPDS feed. For Calibre’s content server, its address with /opds at the end. In the browser the server must allow this site (CORS) and use https.',
      },
      {
        key: 'user',
        label: 'Username',
        type: 'text',
        help: 'Only if the catalog asks for a login.',
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        help: 'Stays on this phone. Sent as HTTP Basic, so use https outside your home network.',
      },
    ],
  },
  library: (args) => library(args.settings || {}, args.library && args.library.cursor),
});
