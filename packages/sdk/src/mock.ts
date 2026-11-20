type Awaitable<T> = T | Promise<T>;

/** A `Response`, a string sent as text, or anything else sent as JSON. */
export type MockAnswer = Response | string | number | boolean | object | null;

/**
 * Routes by `"<url>"` or `"<METHOD> <url>"`. A URL ending in `*` matches every URL that starts
 * with the rest; otherwise the whole URL, query included, must match.
 */
export type MockRoutes = Record<string, MockAnswer | ((request: Request) => Awaitable<MockAnswer>)>;

export type MockFetch = ((
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>) & {
  /** Every request, matched or not, in order. */
  calls: Request[];
  /** Requests no route matched; each one also failed with an error. */
  unmatched: Request[];
};

type Route = {
  method: string | null;
  url: string;
  prefix: boolean;
  answer: MockRoutes[string];
};

function parseRoutes(routes: MockRoutes): Route[] {
  return Object.entries(routes).map(([key, answer]) => {
    const match = /^([A-Z]+)\s+(\S+)$/.exec(key.trim());
    const url = match ? (match[2] ?? '') : key.trim();
    const prefix = url.endsWith('*');
    return {
      method: match ? (match[1] ?? null) : null,
      url: prefix ? url.slice(0, -1) : url,
      prefix,
      answer,
    };
  });
}

function toResponse(answer: MockAnswer): Response {
  if (answer instanceof Response) return answer;
  if (typeof answer === 'string')
    return new Response(answer, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(JSON.stringify(answer), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * A `fetch` for an add-on's tests that answers only the routes given and fails every other
 * request, so tests never reach a real service. The longest matching route wins.
 *
 * ```ts
 * const fetch = mockFetch({
 *   'https://openlibrary.org/works/OL1W.json': { title: 'A Christmas Carol' },
 *   'https://openlibrary.org/authors/*': (request) => new Response('{}', { status: 404 }),
 * });
 * ```
 */
export function mockFetch(routes: MockRoutes): MockFetch {
  const table = parseRoutes(routes).sort((a, b) => b.url.length - a.url.length);
  const calls: Request[] = [];
  const unmatched: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    calls.push(request);
    const route = table.find(
      (r) =>
        (r.method === null || r.method === request.method) &&
        (r.prefix ? request.url.startsWith(r.url) : request.url === r.url),
    );
    if (!route) {
      unmatched.push(request);
      throw new Error(`mockFetch: no route for ${request.method} ${request.url}`);
    }
    const answer = typeof route.answer === 'function' ? await route.answer(request) : route.answer;
    // A Response's body can be read once; hand out a copy so a route answers every time.
    return answer instanceof Response ? answer.clone() : toResponse(answer);
  };
  return Object.assign(fetch, { calls, unmatched });
}
