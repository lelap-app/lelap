import { createServer, type IncomingMessage } from 'node:http';

type Handler = { fetch: (request: Request) => Response | Promise<Response> };

/**
 * Serves a fetch handler (the services' Hono apps) over Node's HTTP server. `onStop` runs when
 * Docker stops the container, before the process ends.
 */
export function serve(app: Handler, port: number, name: string, onStop?: () => void): void {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const response = await app.fetch(toRequest(req, port));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"Server error."}');
      }
    })();
  }).listen(port, () => console.log(`${name} listening on :${port}`));
  // As PID 1, Node ignores SIGTERM unless it handles it, and Docker would wait 10 s to kill it.
  const stop = () => {
    server.close();
    onStop?.();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

function toRequest(req: IncomingMessage, port: number): Request {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${port}`}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method ?? 'GET',
    headers,
    ...(hasBody ? { body: req as unknown as ReadableStream, duplex: 'half' } : {}),
  } as RequestInit);
}

export const port = (fallback: number) => Number(process.env.PORT ?? fallback);
