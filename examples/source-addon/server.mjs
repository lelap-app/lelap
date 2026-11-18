// Serves the add-on with `node:http`: each request becomes a Fetch API `Request` for
// `addon.fetch`, and its `Response` is written back.
import { createServer } from 'node:http';

import { createSourceAddon } from './addon.mjs';

export function createAddonServer(addon = createSourceAddon()) {
  return createServer(async (req, res) => {
    const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'addon'}`), {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, String(value)]],
      ),
    });
    const response = await addon.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  createAddonServer().listen(port, () => {
    console.log(`Add-on running: http://localhost:${port}/manifest.json`);
  });
}
