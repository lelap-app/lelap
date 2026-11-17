/* global BUILD, SHELL, NEVER_CACHE */
// The web app's service worker. `scripts/fix-web-export.mjs` puts BUILD (a hash of the export),
// SHELL (every file of the export) and NEVER_CACHE (the sync server's origin) in front of this
// file and writes it to `sw.js`.
//
// - The app shell comes from the cache, so the app starts offline. A new build installs next to
//   the old one and waits; it takes over once every tab of the old one is closed.
// - Add-on and proxy calls go to the network first and fall back to their last answer offline.
// - Audio is never cached: only JSON and XML answers are kept.

const SHELL_CACHE = `lelap-shell-${BUILD}`;
const DATA_CACHE = 'lelap-data';
const KEEP = /^(application\/([\w.+-]*\+)?(json|xml)|text\/xml)\b/i;
const DATA_LIMIT = 300;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('lelap-shell-') && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      // Controls the first visit's tab too, so it works offline without a reload.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      // A one-page app: every route is the page at `/`.
      event.respondWith(fromShell('/', request));
    } else if (SHELL.includes(url.pathname)) {
      event.respondWith(fromShell(url.pathname, request));
    }
    return;
  }
  if (!url.protocol.startsWith('http') || NEVER_CACHE.includes(url.origin)) return;
  // Media elements stream with range requests; the browser handles those itself.
  if (request.destination === 'audio' || request.destination === 'video') return;
  if (request.headers.has('range') || request.headers.has('authorization')) return;
  event.respondWith(networkFirst(request));
});

async function fromShell(path, request) {
  const cached = await caches.match(path, { cacheName: SHELL_CACHE });
  return cached ?? fetch(request);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (
      response.ok &&
      response.type === 'cors' &&
      KEEP.test(response.headers.get('content-type') ?? '')
    ) {
      const copy = response.clone();
      caches.open(DATA_CACHE).then(async (cache) => {
        await cache.put(request, copy);
        const keys = await cache.keys();
        // Oldest first: the cache keeps the latest answers only.
        await Promise.all(keys.slice(0, -DATA_LIMIT).map((key) => cache.delete(key)));
      });
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { cacheName: DATA_CACHE });
    if (cached) return cached;
    throw error;
  }
}
