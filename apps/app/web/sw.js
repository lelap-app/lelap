/* global BUILD, SHELL, NEVER_CACHE */
// The web app's service worker. `scripts/fix-web-export.mjs` puts BUILD (a hash of the export),
// SHELL (every file of the export) and NEVER_CACHE (the sync server's origin) in front of this
// file and writes it to `sw.js`.
//
// - The app shell comes from the cache, so the app starts offline. A new build installs next to
//   the old one and waits; it takes over once every tab of the old one is closed.
// - Add-on and proxy calls go to the network first and fall back to their last answer offline.
// - Audio is never cached: only JSON and XML answers are kept. For skip silence (M122), the bytes
//   of a file the page asks for are passed on to it as the media element streams them, so it
//   doesn't fetch them a second time; the element gets the same answer.

const SHELL_CACHE = `lelap-shell-${BUILD}`;
const DATA_CACHE = 'lelap-data';
const KEEP = /^(application\/([\w.+-]*\+)?(json|xml)|text\/xml)\b/i;
const DATA_LIMIT = 300;
// Files whose stream the page wants to see; lost when the worker stops, and asked for again.
const TEED = new Set();
const TEE_PIECE = 64 * 1024;
// Each file's size, for answers to closed ranges.
const SIZES = new Map();

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data?.type !== 'lelap-tee' || typeof data.url !== 'string') return;
  TEED.add(data.url);
  if (TEED.size > 20) TEED.delete(TEED.values().next().value);
  event.ports[0]?.postMessage('ok');
});

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
  if (request.destination === 'audio' && request.mode === 'cors' && TEED.has(request.url)) {
    // Only ranges whose Content-Range can be told; others go to the network untouched.
    const asked = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (!request.headers.has('range') || (asked && (!asked[2] || SIZES.has(request.url)))) {
      event.respondWith(tee(event));
      return;
    }
  }
  // Media elements stream with range requests; the browser handles those itself.
  if (request.destination === 'audio' || request.destination === 'video') return;
  if (request.headers.has('range') || request.headers.has('authorization')) return;
  event.respondWith(networkFirst(request));
});

/**
 * The element's own answer, with each piece passed on to the page as the element reads it. An
 * element that stops reading (a seek) stops the download too. A host that hides Content-Range
 * from scripts gets it back from the range asked for and Content-Length.
 */
async function tee(event) {
  const request = event.request;
  const response = await fetch(request);
  if (!response.body || (response.status !== 200 && response.status !== 206)) return response;
  const asked = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const length = Number(response.headers.get('content-length')) || 0;
  let range = response.headers.get('content-range');
  const shown = /^bytes (\d+)-/.exec(range ?? '');
  const start = response.status !== 206 ? 0 : shown ? Number(shown[1]) : Number(asked?.[1] ?? 0);
  if (response.status === 206 && !range) {
    const size = SIZES.get(request.url) ?? (asked && !asked[2] ? start + length : null);
    if (!size || !length) return response;
    range = `bytes ${start}-${start + length - 1}/${size}`;
  }
  const size = range ? Number(range.split('/')[1]) || null : length || null;
  if (size) SIZES.set(request.url, size);
  const client = await self.clients.get(event.clientId);
  if (!client) return response;
  const reader = response.body.getReader();
  let at = start;
  let held = [];
  let heldBytes = 0;
  const pass = () => {
    if (heldBytes === 0) return;
    const bytes = new Uint8Array(heldBytes);
    let offset = 0;
    for (const part of held) {
      bytes.set(part, offset);
      offset += part.length;
    }
    client.postMessage(
      { type: 'lelap-bytes', url: request.url, start: at, bytes: bytes.buffer, size },
      [bytes.buffer],
    );
    at += heldBytes;
    held = [];
    heldBytes = 0;
  };
  const body = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        pass();
        controller.close();
        return;
      }
      controller.enqueue(value);
      held.push(value.slice());
      heldBytes += value.length;
      if (heldBytes >= TEE_PIECE) pass();
    },
    cancel(reason) {
      pass();
      return reader.cancel(reason);
    },
  });
  const headers = new Headers(response.headers);
  if (range) headers.set('content-range', range);
  // A 200 says nothing about ranges: a host that ignores them must not look seekable.
  if (response.status === 206) headers.set('accept-ranges', 'bytes');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

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
