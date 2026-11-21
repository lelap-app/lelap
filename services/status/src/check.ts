export type Target = { name: string; url: string };

export type CheckResult = Target & {
  up: boolean;
  /** HTTP status, or null when no answer came. */
  status: number | null;
  ms: number;
  error: string | null;
};

export const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Lelap status (+https://github.com/lelap-app/lelap)';
/** A health answer is a few bytes; anything bigger is not read as one. */
const HEALTH_BYTES = 16 * 1024;

const PLACEHOLDER = /\{([A-Z0-9_]+)\}/g;

/**
 * Reads `TARGETS`: one `name | address` per line, with `{NAME}` filled from `vars`. Lines whose
 * variable is unset are left out, so a fork checks only what it deploys.
 */
export function parseTargets(text: string, vars: Record<string, unknown>): Target[] {
  const targets: Target[] = [];
  for (const line of text.split('\n')) {
    const bar = line.indexOf('|');
    if (bar < 0) continue;
    const name = line.slice(0, bar).trim();
    let missing = false;
    const raw = line
      .slice(bar + 1)
      .trim()
      .replace(PLACEHOLDER, (_, key: string) => {
        const value = vars[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        missing = true;
        return '';
      });
    if (!name || missing) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (targets.some((t) => t.name === name)) continue;
    targets.push({ name, url: url.href });
  }
  return targets;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** What an add-on's `/health` (or ours) says, when the answer is one. */
async function healthSays(response: Response): Promise<string | null> {
  const type = response.headers.get('Content-Type') ?? '';
  const length = Number(response.headers.get('Content-Length') ?? '0');
  if (!type.includes('json') || length > HEALTH_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const text = await response.text();
  if (text.length > HEALTH_BYTES) return null;
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === 'object' && 'status' in body && body.status === 'down') {
      const message = 'message' in body && typeof body.message === 'string' ? body.message : '';
      return message || 'Says it is down';
    }
  } catch {
    // Not JSON after all: the HTTP status decides.
  }
  return null;
}

/** Asks one target once. Never throws: a failure is a result. */
export async function checkTarget(
  fetchFn: Fetch,
  target: Target,
  timeoutMs = TIMEOUT_MS,
  clock: () => number = Date.now,
): Promise<CheckResult> {
  const started = clock();
  const done = (up: boolean, status: number | null, error: string | null): CheckResult => ({
    ...target,
    up,
    status,
    ms: Math.max(0, clock() - started),
    error,
  });
  try {
    const response = await fetchFn(target.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html;q=0.9, */*;q=0.1' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return done(false, response.status, `HTTP ${response.status}`);
    }
    const down = await healthSays(response);
    return done(!down, response.status, down);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError')
      return done(false, null, `No answer within ${Math.round(timeoutMs / 1000)} s`);
    const message = error instanceof Error && error.message ? error.message : String(error);
    return done(false, null, message.slice(0, 200) || 'Could not connect');
  }
}

export function checkAll(fetchFn: Fetch, targets: Target[], timeoutMs = TIMEOUT_MS) {
  return Promise.all(targets.map((target) => checkTarget(fetchFn, target, timeoutMs)));
}
