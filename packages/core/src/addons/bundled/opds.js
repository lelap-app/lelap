/* global addon, lelap */
// Bundled with Lelap (M128): the audiobooks in an OPDS catalog, such as a Calibre content server
// at home or a library's open catalog. Reads OPDS 1.2 (Atom) and OPDS 2.0 (JSON). It runs in the
// app's sandbox and can reach only the address the listener enters.
//
// The scan starts at that address, follows navigation and `next` links on the same server and
// keeps each publication with an audio file or a Readium audiobook manifest; ebooks are left out.
// It goes a few dozen feeds per call and hands the app a cursor (revision 9), so a big catalog
// never runs into the app's time limit for one call. A login goes as HTTP Basic, or as HTTP
// Digest when the server asks for it (M135): the add-on answers it for the feeds, the app for the
// audio and covers (revision 12). A book's summary, language and series come along, and where a
// publication links an OPDS Progression service, the listener's place is read from it and saved
// to it (the `place` resource).

const MAX_PAGES = 2000;
const MAX_BOOKS = 10000;
const PAGES_PER_CALL = 40;
// The first call stays short: adding a server checks the login with it.
const FIRST_CALL_PAGES = 4;
// Progression documents read in one call; they don't count towards the page limit.
const PLACES_PER_CALL = 200;
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
const PROGRESSION_REL = 'http://opds-spec.org/progression';
const PROGRESSION = 'application/opds-progression+json';
// OPDS Progression asks for a device URI; Lelap keeps none per phone.
const DEVICE = { id: 'urn:x-lelap:app', name: 'Lelap' };
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

// --- HTTP Digest -----------------------------------------------------------------------------
// Calibre's content server takes Digest only without https, its default. A sandbox has no MD5, so
// it is here; SHA-256 comes from WebCrypto where the sandbox has it.

function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array((((bytes.length + 8) >> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[words.length - 2] = bytes.length * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
  );
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let block = 0; block < words.length; block += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const sum = (a + f + K[i] + words[block + g]) >>> 0;
      const shift = S[(i >> 4) * 4 + (i % 4)];
      [a, d, c] = [d, c, b];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    [a0, b0, c0, d0] = [(a0 + a) >>> 0, (b0 + b) >>> 0, (c0 + c) >>> 0, (d0 + d) >>> 0];
  }
  let hex = '';
  for (const word of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return hex;
}

const hexOf = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function digestHash(algorithm, text) {
  if (!algorithm.startsWith('SHA-256')) return md5(text);
  return hexOf(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  );
}

/** The Digest challenges in a `WWW-Authenticate` value, which may hold several schemes. */
function digestChallenges(header) {
  const out = [];
  const token = /[\s,]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)(\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*)))?/y;
  let scheme = null;
  let params = {};
  const finish = () => {
    if (scheme && scheme.toLowerCase() === 'digest' && params.nonce) out.push(params);
  };
  let m;
  while (token.lastIndex < header.length && (m = token.exec(header))) {
    if (m[2]) {
      params[m[1].toLowerCase()] = m[3] !== undefined ? m[3].replace(/\\(.)/g, '$1') : m[4];
    } else {
      finish();
      scheme = m[1];
      params = {};
    }
  }
  finish();
  return out;
}

const ALGORITHMS = {
  MD5: 'MD5',
  'MD5-SESS': 'MD5-sess',
  'SHA-256': 'SHA-256',
  'SHA-256-SESS': 'SHA-256-sess',
};

/** The challenge Lelap answers among a refusal's: SHA-256 where WebCrypto has it, else MD5. */
function digestChallenge(header) {
  const usable = [];
  for (const c of digestChallenges(String(header || ''))) {
    const algorithm = ALGORITHMS[String(c.algorithm || 'MD5').toUpperCase()];
    if (!algorithm) continue;
    if (algorithm.startsWith('SHA') && !(globalThis.crypto && crypto.subtle)) continue;
    const offered = c.qop ? c.qop.split(',').map((q) => q.trim().toLowerCase()) : null;
    if (offered && !offered.includes('auth')) continue;
    usable.push({
      realm: c.realm || '',
      nonce: c.nonce,
      opaque: c.opaque,
      algorithm,
      qop: offered ? 'auth' : null,
    });
  }
  return usable.find((c) => c.algorithm.startsWith('SHA')) || usable[0] || null;
}

const quoted = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;

/** The `Authorization` for one request with the server's latest challenge. */
async function digestAnswer(s, method, url) {
  const c = s.digest.challenge;
  const at = new URL(url);
  const uri = at.pathname + at.search;
  const nc = (++s.digest.count).toString(16).padStart(8, '0');
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const cnonce = hexOf(bytes);
  const h = (text) => digestHash(c.algorithm, text);
  let ha1 = await h(`${s.user}:${c.realm}:${s.password}`);
  if (c.algorithm.endsWith('-sess')) ha1 = await h(`${ha1}:${c.nonce}:${cnonce}`);
  const ha2 = await h(`${method}:${uri}`);
  const response = c.qop
    ? await h(`${ha1}:${c.nonce}:${nc}:${cnonce}:${c.qop}:${ha2}`)
    : await h(`${ha1}:${c.nonce}:${ha2}`);
  // A name beyond ASCII goes in RFC 7616's extended form: headers carry ASCII only.
  const ascii = /^[\x20-\x7e]*$/.test(s.user);
  const parts = [
    ascii ? `username=${quoted(s.user)}` : `username*=UTF-8''${encodeURIComponent(s.user)}`,
    `realm=${quoted(c.realm)}`,
    `nonce=${quoted(c.nonce)}`,
    `uri=${quoted(uri)}`,
    `algorithm=${c.algorithm}`,
    `response="${response}"`,
  ];
  if (c.qop) parts.push(`qop=${c.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (c.opaque !== undefined) parts.push(`opaque=${quoted(c.opaque)}`);
  return `Digest ${parts.join(', ')}`;
}

const headerOf = (response, name) =>
  (response.headers && response.headers.get && response.headers.get(name)) || '';

/**
 * A request with the catalog's login: Basic at first, Digest once the server asks for it. A
 * Calibre server that takes Digest only answers a Basic login with 400, so it is asked again
 * without one for its challenge.
 */
async function send(s, url, init) {
  const method = init.method || 'GET';
  let answered = false;
  let probed = false;
  for (;;) {
    const auth = s.digest ? await digestAnswer(s, method, url) : s.auth;
    const response = await lelap.fetch(url, {
      ...init,
      method,
      headers: { ...init.headers, ...(auth ? { Authorization: auth } : {}) },
    });
    if (!s.user) return response;
    // Refused, or a nonce gone stale: once more with the server's new challenge.
    if (response.status === 401 && !answered) {
      const challenge = digestChallenge(headerOf(response, 'www-authenticate'));
      if (challenge) {
        s.digest = { challenge, count: 0 };
        answered = true;
        continue;
      }
    }
    if (response.status === 400 && !s.digest && !probed) {
      probed = true;
      const bare = await lelap.fetch(url, { headers: { Accept: ACCEPT } });
      const challenge =
        bare.status === 401 ? digestChallenge(headerOf(bare, 'www-authenticate')) : null;
      if (challenge) {
        s.digest = { challenge, count: 0 };
        answered = true;
        continue;
      }
    }
    return response;
  }
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
  // `parts` keeps text and elements in order, for content whose lines are split by `<br/>`.
  const root = { name: '#root', attrs: {}, children: [], parts: [], text: '' };
  const addText = (element, text) => {
    element.text += text;
    element.parts.push(text);
  };
  const stack = [root];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  const attr = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      addText(top, unescapeXml(text.slice(i)));
      break;
    }
    if (lt > i) addText(top, unescapeXml(text.slice(i, lt)));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? text.length : end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      addText(top, text.slice(lt + 9, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end + 3;
    } else if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      i = end < 0 ? text.length : end + 1;
    } else {
      tag.lastIndex = lt;
      const m = tag.exec(text);
      if (!m) {
        addText(top, '<');
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
      const element = { name, attrs, children: [], parts: [], text: '' };
      top.children.push(element);
      top.parts.push(element);
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
  const about = calibreContent(kid(entry, 'content'));
  return {
    description: atomText(kid(entry, 'summary')) || about.description,
    language: textOf(kid(entry, 'language')),
    series: about.series,
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

/** An element's text with its line breaks (`br`, `p`, `div`), for Calibre's content. */
function linesOf(element) {
  if (!element) return '';
  const inner = element.parts
    .map((part) => (typeof part === 'string' ? part : linesOf(part)))
    .join('');
  return ['br', 'p', 'div', 'li'].includes(element.name) ? `${inner}\n` : inner;
}

/** HTML as plain text, its paragraphs and line breaks kept as new lines. */
function plainText(html) {
  return unescapeXml(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  );
}

const tidyLines = (lines) =>
  lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

// Calibre writes its fields first, one a line, as `TAGS: …` and `SERIES: Name [2]` in the
// server's language, then the book's comments.
const LABEL = /^\p{Lu}[\p{Lu}\p{M} ]{0,24}:\s*(.*)$/u;
const IN_SERIES = /^(.+?)\s*\[(\d+(?:\.\d+)?)\]$/;

/** The series and description in an Atom entry's content, as Calibre writes them. */
function calibreContent(content) {
  if (!content) return { series: [], description: '' };
  const raw = plainText(content.attrs.type === 'xhtml' ? linesOf(content) : textOf(content));
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const series = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const label = LABEL.exec(lines[i]);
    if (!label) break;
    const named = IN_SERIES.exec(label[1].trim());
    if (named && series.length === 0) series.push({ name: named[1], position: named[2] });
  }
  return { series, description: tidyLines(lines.slice(i)) };
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
  const belongs = (metadata.belongsTo && metadata.belongsTo.series) || metadata.series;
  return {
    description:
      typeof metadata.description === 'string'
        ? tidyLines(plainText(metadata.description).split('\n'))
        : '',
    language: String(asList(metadata.language)[0] || ''),
    series: asList(belongs)
      .map((s) => ({
        name: nameOf(s),
        ...(s && typeof s === 'object' && s.position != null
          ? { position: String(s.position) }
          : {}),
      }))
      .filter((s) => s.name),
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
    response = await send(s, url, { headers: { Accept: ACCEPT } });
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
  // Its challenge then answers the login; a browser hides the challenge without CORS headers
  // that show it.
  if (response.status === 400 && s.auth && !s.digest) {
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

const LANGUAGE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

/** What a publication says about its book, for its first file (revision 12). */
function aboutBook(p) {
  const description = (p.description || '').slice(0, 10000);
  const language = LANGUAGE.test(p.language || '') && p.language.length <= 35 ? p.language : '';
  const series = (p.series || []).slice(0, 8).map((s) => ({
    name: String(s.name).slice(0, 500),
    ...(s.position ? { position: String(s.position).slice(0, 20) } : {}),
  }));
  return {
    ...(description ? { description } : {}),
    ...(language ? { language } : {}),
    ...(series.length > 0 ? { series } : {}),
  };
}

/**
 * One book's files, in a folder named after its author and title, its cover last. `ref` is the
 * book's OPDS Progression address, which the app hands back with a place.
 */
function bookFiles(scan, p, parts, cover, ref) {
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
      ...(i === 0 ? aboutBook(p) : {}),
      ...(ref ? { ref } : {}),
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
    user,
    password: settings.password || '',
    auth: user ? basic(user, settings.password || '') : null,
    // The server's latest Digest challenge, once it asked for one.
    digest: null,
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
    // Books whose places are still to read from their progression service.
    places: [],
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
  let progression = progressionOf(scan, p.links, base);
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
        if (!p.description) p.description = manifest.description;
        if (!p.language) p.language = manifest.language;
        if (p.series.length === 0) p.series = manifest.series;
        progression = progression || progressionOf(scan, manifest.links, at);
      }
    }
  }
  if (!parts) return [];
  scan.books.add(key);
  scan.count++;
  if (scan.count > MAX_BOOKS) throw tooBig('10,000 audiobooks');
  const files = bookFiles(scan, p, parts, coverOf(p, base), progression);
  if (progression) {
    scan.places.push({ url: progression, base, parts, files: files.slice(0, parts.length) });
  }
  return files;
}

// --- Places (OPDS Progression 1.0) ------------------------------------------------------------

/** A publication's OPDS Progression address on the catalog's own server; null without one. */
function progressionOf(scan, links, base) {
  const link = (links || []).find(
    (l) => l.rels.includes(PROGRESSION_REL) || l.type.split(';')[0].trim() === PROGRESSION,
  );
  return link ? sameServer(link.href, base, scan.s.origin) : null;
}

const sumOf = (list) => list.reduce((sum, n) => sum + n, 0);

/** The file and the place in it for a time on the whole book, when every part's length is known. */
function inBook(parts, bookMs) {
  const lengths = parts.map((p) => p.durationMs);
  if (lengths.some((ms) => !(ms > 0))) return parts.length === 1 ? { index: 0, ms: bookMs } : null;
  let left = Math.max(0, bookMs);
  for (let i = 0; i < parts.length; i++) {
    if (left < lengths[i] || i === parts.length - 1)
      return { index: i, ms: Math.min(left, lengths[i]) };
    left -= lengths[i];
  }
  return null;
}

/**
 * A progression document as a place in one file. A `#t=` reference with a file's address names
 * the file; one without names a time on the whole book; else `progression` is a share of the book.
 */
function placeOf(doc, parts, base) {
  if (!doc || typeof doc !== 'object') return null;
  const at = Date.parse(doc.modified || '');
  if (!(at >= 0)) return null;
  let found = null;
  for (const ref of asList(doc.references)) {
    const m = /^([^#]*)#t=(?:npt:)?(\d+(?:\.\d+)?)/.exec(String(ref || ''));
    if (!m) continue;
    const ms = Math.round(Number(m[2]) * 1000);
    if (m[1] === '') found = inBook(parts, ms);
    else {
      const url = absolute(m[1], base);
      const index = parts.findIndex((p) => p.url === url);
      if (index >= 0) found = { index, ms };
    }
    if (found) break;
  }
  const share = Number(doc.progression);
  if (!found && share >= 0 && share <= 1) {
    const total = sumOf(parts.map((p) => p.durationMs || 0));
    if (parts.every((p) => p.durationMs > 0)) found = inBook(parts, share * total);
  }
  if (!found) return null;
  return {
    index: found.index,
    place: { positionMs: Math.max(0, found.ms), at, ...(share >= 1 ? { played: true } : {}) },
  };
}

/** Reads a book's place from its progression service into its file; a failure leaves it out. */
async function readPlace(scan, job) {
  try {
    const response = await send(scan.s, job.url, {
      headers: { Accept: `${PROGRESSION}, application/json;q=0.9` },
    });
    if (!response.ok) return;
    const text = await response.text();
    if (!text.trim()) return;
    const found = placeOf(JSON.parse(text), job.parts, job.base);
    if (found && job.files[found.index]) job.files[found.index].place = found.place;
  } catch {
    // A place is a bonus: the book lists without it.
  }
}

/**
 * Saves the listener's place to the book's progression service. The share of the book needs every
 * file's length; the time goes as a `#t=` reference, with the file's address for a book of
 * several files.
 */
async function savePlace(settings, report) {
  const ref = report.file.ref || (report.files.find((f) => f.ref) || {}).ref;
  const s = session(settings);
  const url = ref && sameServer(ref, s.start, s.origin);
  if (!url) return { saved: false };
  const files = report.files;
  const index = Math.max(
    0,
    files.findIndex((f) => f.url === report.file.url),
  );
  const lengths = files.map((f) => f.durationMs || 0);
  const total = sumOf(lengths);
  const known = lengths.every((ms) => ms > 0);
  const bookMs = sumOf(lengths.slice(0, index)) + report.positionMs;
  // Without every length the share would be a guess, and a server that reads only the share
  // would move the book back; the place waits for the lengths.
  if (!report.finished && !(known && total > 0)) return { saved: false };
  const share = report.finished ? 1 : Math.min(1, bookMs / total);
  const seconds = (Math.max(0, report.positionMs) / 1000).toFixed(3);
  const doc = {
    modified: new Date(report.at).toISOString(),
    device: DEVICE,
    progression: Math.round(share * 1e6) / 1e6,
    references: [files.length > 1 ? `${report.file.url}#t=${seconds}` : `#t=${seconds}`],
  };
  const response = await send(s, url, {
    method: 'PUT',
    headers: {
      'Content-Type': PROGRESSION,
      Accept: `${PROGRESSION}, application/problem+json;q=0.9`,
    },
    body: JSON.stringify(doc),
  });
  if (response.ok) return { saved: true };
  // 409: the server has a newer place, which the next scan brings. 400 and 403: sending the same
  // again won't help.
  if ([400, 403, 409].includes(response.status)) return { saved: false };
  throw new Error(`The catalog answered HTTP ${response.status} for the place.`);
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
    // Places are asked one book at a time: a call that read many ends early, never the scan.
    let read = 0;
    for (let n = 0; n < pages && scan.queue.length > 0 && read < PLACES_PER_CALL; n++) {
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
      // A feed's places are asked at once; the app's sandbox lets a few run together.
      const places = scan.places.splice(0);
      read += places.length;
      await Promise.all(places.map((job) => readPlace(scan, job)));
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
    // The app answers a Digest login per request itself (revision 12).
    ...(scan.s.digest
      ? { digest: { username: scan.s.user, password: scan.s.password } }
      : scan.s.auth
        ? { headers: { Authorization: scan.s.auth } }
        : {}),
    ...(done ? {} : { next: id }),
  };
}

addon({
  manifest: {
    id: 'app.lelap.opds',
    version: '1.1.0',
    protocol: 1,
    protocolVersion: 12,
    name: 'OPDS',
    description:
      'The audiobooks in an OPDS catalog, such as a Calibre content server or a library’s open catalog. Ebooks are left out.',
    types: ['audiobook'],
    resources: ['library', 'place'],
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
        help: 'Stays on this phone. Sent as HTTP Basic, or as Digest when the server asks for it; use https outside your home network.',
      },
    ],
  },
  library: (args) => library(args.settings || {}, args.library && args.library.cursor),
  place: (args) => savePlace(args.settings || {}, args.place),
});
