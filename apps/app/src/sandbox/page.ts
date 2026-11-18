// The page an in-app add-on runs in (M38). Its content policy allows inline scripts and a worker
// made from them, and nothing else: no network, no frames, no storage beyond the page. The
// add-on reaches the outside only through `lelap.fetch`, which asks the app, and the app fetches
// only from the hosts the add-on declared. The bootstrap answers the same routes as a web add-on.
//
// Since M57 the add-on's code runs in a worker inside the page. A worker can't navigate, open a
// window or add an element, so a server's settings, which reach `library` calls as `settings`,
// can't leave in an address either. Where a worker can't start, the code runs in the page as
// before and the app never hands it settings (`isolated: false`).

const ADDON_SIDE = `
(function (post) {
  var pending = {};
  var seq = 0;
  var def = null;
  self.addon = function (d) { def = d; };
  self.lelap = {
    fetch: function (url, init) {
      return new Promise(function (resolve, reject) {
        var id = 'f' + (++seq);
        pending[id] = { resolve: resolve, reject: reject };
        post({ t: 'fetch', id: id, url: String(url), init: init ? {
          method: init.method, headers: init.headers,
          body: typeof init.body === 'string' ? init.body : undefined
        } : undefined });
      });
    }
  };
  var dec = function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } };
  var route = function (path) {
    var clean = path.replace(/^\\/+/, '');
    if (clean === 'manifest.json') return { resource: 'manifest' };
    if (!/\\.json$/.test(clean)) return null;
    var p = clean.slice(0, -5).split('/');
    var types = ['audiobook', 'podcast', 'episode'];
    if (p.length < 3 || types.indexOf(dec(p[1])) < 0) return null;
    var r = { resource: p[0], type: dec(p[1]), id: dec(p[2]) };
    if (p[0] === 'catalog') {
      var extra = {};
      (p[3] || '').split('&').forEach(function (pair) {
        if (!pair) return;
        var at = pair.indexOf('=');
        extra[dec(at < 0 ? pair : pair.slice(0, at))] = at < 0 ? '' : dec(pair.slice(at + 1));
      });
      r.extra = extra;
      return p.length <= 4 ? r : null;
    }
    return p.length === 3 ? r : null;
  };
  var handle = function (id, path, settings) {
    Promise.resolve().then(function () {
      if (!def) throw new Error('The file never called addon({...}).');
      var r = route(path);
      if (!r) return { status: 404, body: { error: 'Not found' } };
      if (r.resource === 'manifest') return { status: 200, body: def.manifest };
      var h = def[r.resource];
      if (typeof h !== 'function') return { status: 404, body: { error: 'Not found' } };
      if (r.resource === 'library') r.settings = Object.freeze(settings || {});
      return Promise.resolve(h(r)).then(function (b) {
        return b == null ? { status: 404, body: { error: 'Not found' } } : { status: 200, body: b };
      });
    }).then(function (res) {
      post({ t: 'result', id: id, status: res.status, body: res.body });
    }, function (err) {
      post({ t: 'result', id: id, status: 500, body: { error: String((err && err.message) || err) } });
    });
  };
  self.__lelapReceive = function (data) {
    var m;
    try { m = JSON.parse(typeof data === 'string' ? data : ''); } catch (x) { return; }
    if (m.t === 'fetched') {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      if (m.error) { p.reject(new Error(m.error)); return; }
      var headers = m.headers || {};
      p.resolve({
        ok: m.status >= 200 && m.status < 300,
        status: m.status,
        headers: { get: function (k) { return headers[String(k).toLowerCase()] || null; } },
        text: function () { return Promise.resolve(m.text); },
        json: function () { return Promise.resolve(JSON.parse(m.text)); }
      });
    } else if (m.t === 'call') {
      handle(m.id, m.path, m.settings);
    }
  };
  self.onerror = function (msg) { post({ t: 'log', message: String(msg) }); };
})
`;

// The page's own script: starts the worker and passes messages both ways. `ADDON_SIDE_TEXT` and
// `ADDON_CODE` are replaced with string literals.
const PAGE_SIDE = `
(function () {
  var toApp = function (text) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
    else window.parent.postMessage(text, '*');
  };
  var ready = function (isolated) { toApp(JSON.stringify({ t: 'ready', isolated: isolated })); };
  var addonSide = ADDON_SIDE_TEXT;
  var code = ADDON_CODE;
  var worker = null;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([
      addonSide + '(function (m) { self.postMessage(JSON.stringify(m)); });\\n' +
      'self.onmessage = function (e) { self.__lelapReceive(e.data); };\\n' +
      // After the add-on's code ran, or threw.
      'setTimeout(function () { self.postMessage(JSON.stringify({ t: "started" })); }, 0);\\n' +
      code
    ], { type: 'text/javascript' })));
  } catch (e) {
    worker = null;
  }
  if (worker) {
    var started = false;
    worker.onmessage = function (e) {
      if (typeof e.data !== 'string') return;
      if (!started && e.data === '{"t":"started"}') { started = true; ready(true); return; }
      toApp(e.data);
    };
  } else {
    // No worker here: the add-on runs in the page, as before M57, and the app hands it no settings.
    window.__lelapToApp = function (m) { toApp(JSON.stringify(m)); };
    var run = function (text) {
      var s = document.createElement('script');
      s.textContent = text;
      document.body.appendChild(s);
    };
    // Said first: the app takes the first word, and code in the page could claim otherwise.
    ready(false);
    run(addonSide + '(window.__lelapToApp);');
    run(code);
  }
  var fromApp = function (e) {
    if (typeof e.data !== 'string') return;
    if (worker) worker.postMessage(e.data);
    else if (window.__lelapReceive) window.__lelapReceive(e.data);
  };
  window.addEventListener('message', fromApp);
  document.addEventListener('message', fromApp);
})();
`;

// A JavaScript string inside an inline script: `<` is escaped so nothing closes the element.
const literal = (text: string) => JSON.stringify(text).replace(/</g, '\\u003c');

/** The add-on's code inside a closed page. */
export function sandboxPage(code: string): string {
  // Functions as replacements, so `$&` and friends in the code stay as they are.
  const page = PAGE_SIDE.replace('ADDON_SIDE_TEXT', () => literal(ADDON_SIDE)).replace(
    'ADDON_CODE',
    () => literal(code),
  );
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:">
</head><body><script>${page}</script>
</body></html>`;
}
