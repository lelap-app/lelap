/* global addon, lelap */
// Bundled with Lelap (M61): the listener's Open Library reading log. Starting a book puts its work
// on “Currently reading”, finishing it on “Already read”; nothing else reaches Open Library, no
// times and no progress. It runs in the app's sandbox and can reach only openlibrary.org.
//
// Open Library has no API tokens. Its JSON login takes the listener's archive.org S3 keys and
// answers with a `session` cookie, which the bookshelves endpoint needs. The keys stay sealed on
// the phone and reach only this add-on's `scrobble` calls; the cookie lives for one call. The app
// adds `client` (the User-Agent) to the settings, and in development builds `server`, a stand-in
// for openlibrary.org that the sandbox then also lets it reach.

const OPEN_LIBRARY = 'https://openlibrary.org';
/** Open Library's preset shelves. */
const SHELF = { currentlyReading: 2, alreadyRead: 3 };
/** Open Library asks identified clients for no more than 3 requests a second. */
const GAP_MS = 350;
const WORK = /^OL\d+W$/;

const REJECTED =
  'Open Library did not accept these S3 keys. Copy them again from archive.org/account/s3.php.';
/** Login errors the listener has to fix on archive.org or Open Library; others are retried. */
const ACCOUNT_ERRORS = {
  invalid_s3keys: REJECTED,
  account_blocked: 'Open Library says this account is blocked.',
  account_locked: 'Open Library says this account is locked.',
  account_not_found: 'Open Library found no account for these keys. Sign in there once first.',
  account_not_verified: 'Open Library asks you to verify your account first.',
  ia_account_not_verified: 'archive.org asks you to verify your account first.',
};

/**
 * An error with the status the app's outbox reads: 401 asks to set up again, 5xx retries.
 * `retryAfter` (seconds) is how long Open Library asked to wait; the outbox waits at least that.
 */
function failure(status, message, retryAfter) {
  const error = new Error(message);
  error.status = status;
  if (retryAfter) error.retryAfter = retryAfter;
  return error;
}

/** Seconds from a `Retry-After` header, in seconds or as a date; null when there is none. */
function retryAfterOf(response) {
  const value = (response.headers && response.headers.get('retry-after')) || '';
  if (/^\d+$/.test(value.trim())) return Math.min(Number(value.trim()), 24 * 60 * 60);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.min(Math.round((date - Date.now()) / 1000), 24 * 60 * 60));
}

/** The Open Library work an item is, from its `ol:` ID or its `ol` external ID; never guessed. */
function workOf(item) {
  const id = typeof item.id === 'string' && item.id.startsWith('ol:') ? item.id.slice(3) : '';
  if (WORK.test(id)) return id;
  const external = ((item.externalIds && item.externalIds.ol) || '').trim();
  return WORK.test(external) ? external : null;
}

/**
 * The shelf each work ends on: the last start or finish per work, oldest first. Progress, pauses,
 * abandons and ratings don't move a book on Open Library, nor does a start that carries on with a
 * book begun before (`resumed`): the first start put it on the shelf, and a finished book stays read.
 * Since revision 10 the app sends `resumed` only once this add-on heard of the book, so a book
 * begun before the reading log was set up still reaches Currently reading.
 */
function shelvesFor(events) {
  const shelves = new Map();
  const sorted = events.slice().sort((a, b) => a.at - b.at);
  for (const event of sorted) {
    if (!event.item || event.item.type !== 'audiobook') continue;
    if (event.event !== 'start' && event.event !== 'finish') continue;
    if (event.event === 'start' && event.resumed === true) continue;
    const work = workOf(event.item);
    if (!work) continue;
    shelves.set(work, event.event === 'finish' ? SHELF.alreadyRead : SHELF.currentlyReading);
  }
  return shelves;
}

/** The `session` cookie's value from a login answer's `set-cookie`, joined with commas or not. */
function sessionCookie(setCookie) {
  const match = /(?:^|[,;]\s*)session=([^;,\s]+)/.exec(setCookie || '');
  // An emptied cookie (`session=""`) is a logout, not a session.
  return match && match[1] !== '""' ? match[1] : null;
}

function connection(settings) {
  const base = (settings.server || OPEN_LIBRARY).replace(/\/+$/, '');
  const headers = { Accept: 'application/json' };
  if (settings.client) headers['User-Agent'] = settings.client;
  return { base, headers, access: settings.access || '', secret: settings.secret || '' };
}

const busy = (response) =>
  response.status === 429
    ? failure(503, 'Open Library asks to slow down.', retryAfterOf(response))
    : failure(502, `Open Library answered ${response.status}.`, retryAfterOf(response));

async function login(c) {
  // The JSON login takes S3 keys only; Open Library refuses passwords there.
  const response = await lelap.fetch(`${c.base}/account/login`, {
    method: 'POST',
    headers: Object.assign({}, c.headers, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ access: c.access, secret: c.secret }),
  });
  if (response.status === 400) {
    let code;
    try {
      code = JSON.parse(await response.text()).error;
    } catch {
      code = null;
    }
    const message = typeof code === 'string' ? ACCOUNT_ERRORS[code] : undefined;
    throw message ? failure(401, message) : failure(502, 'Open Library could not sign in.');
  }
  if (response.status === 401 || response.status === 403) throw failure(401, REJECTED);
  if (!response.ok) throw busy(response);
  const session = sessionCookie(response.headers.get('set-cookie'));
  if (!session) throw failure(401, REJECTED);
  return session;
}

/** Puts a work on a shelf; false when Open Library refuses that work, which a retry won't change. */
async function shelve(c, session, work, shelf) {
  const response = await lelap.fetch(`${c.base}/works/${work}/bookshelves.json`, {
    method: 'POST',
    headers: Object.assign({}, c.headers, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `session=${session}`,
    }),
    // Without `dont_remove`, posting the shelf a work is already on takes it off again.
    body: `bookshelf_id=${shelf}&dont_remove=true`,
  });
  if (!response.ok) throw busy(response);
  let body;
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = null;
  }
  // A refused write answers 200 with an `error` key.
  return !(body && typeof body === 'object' && body.error);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One batch of events. With no events it only signs in: the app's check of the keys when the
 * listener sets the add-on up.
 */
async function scrobble(args) {
  const c = connection(args.settings || {});
  const events = Array.isArray(args.events) ? args.events : [];
  if (events.length === 0) {
    await login(c);
    return { received: 0 };
  }
  const shelves = shelvesFor(events);
  // Most batches are progress and pauses: they move nothing, so they don't sign in.
  if (shelves.size === 0) return { received: events.length };
  const session = await login(c);
  let first = true;
  for (const [work, shelf] of shelves) {
    if (!first) await pause(GAP_MS);
    first = false;
    // A work Open Library refuses is skipped, so it can't hold up the books after it.
    await shelve(c, session, work, shelf);
  }
  return { received: events.length };
}

addon({
  manifest: {
    id: 'app.lelap.openlibrary-log',
    version: '1.1.0',
    protocol: 1,
    protocolVersion: 10,
    name: 'Open Library reading log',
    description:
      'Puts the books you start on Currently reading and the ones you finish on Already read in your Open Library reading log.',
    types: ['audiobook'],
    resources: [{ name: 'scrobble', events: ['start', 'finish'] }],
    catalogs: [],
    sandbox: { hosts: ['openlibrary.org'] },
    settings: [
      {
        key: 'access',
        label: 'S3 access key',
        type: 'text',
        required: true,
        help: 'From archive.org/account/s3.php, signed in with the account you use on Open Library.',
      },
      {
        key: 'secret',
        label: 'S3 secret key',
        type: 'password',
        required: true,
        help: 'Stays on this phone. The keys also work for the rest of archive.org; to stop the add-on, make new ones on the same page.',
      },
    ],
  },
  scrobble,
});
