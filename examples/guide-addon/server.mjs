// Serves an add-on with `node:http`: each request becomes a Fetch API `Request` for `addon.fetch`,
// and its `Response` is written back. The body is passed on for the configure form's POST.
import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function serve(addon) {
  return createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      // Behind Caddy or nginx with HTTPS, the configured manifest address must say https too.
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const request = new Request(new URL(req.url ?? '/', `${proto}://${req.headers.host}`), {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([name, value]) =>
          value === undefined ? [] : [[name, String(value)]],
        ),
        body: chunks.length > 0 && req.method !== 'GET' ? Buffer.concat(chunks) : undefined,
      });
      const response = await addon.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch {
      // A request `Request` refuses, such as one with a broken Host header.
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
}

// `node server.mjs catalog`, `settings` or `source`: the add-on of that step of the guide.
async function load(step) {
  if (step === 'catalog') return (await import('./catalog.mjs')).addon;
  if (step === 'settings') return (await import('./settings.mjs')).addon;
  const { createSourceAddon } = await import('./source.mjs');
  return createSourceAddon({
    folder: process.env.BOOKS_FOLDER ?? './books',
    filesUrl: process.env.FILES_URL ?? 'https://files.example.org',
  });
}

const started = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href;
if (import.meta.url === started) {
  const port = Number(process.env.PORT ?? 8787);
  serve(await load(process.argv[2] ?? 'source')).listen(port, () => {
    console.log(`Add-on running: http://localhost:${port}/manifest.json`);
  });
}
