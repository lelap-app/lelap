import type { ScrobbleEvent } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import {
  grantAccess,
  localGrants,
  memoryGrantStore,
  RENEW_BEFORE_MS,
} from '../src/scrobble/hardcover-grants';
import { challengeFor, GrantGone, type Tokens } from '../src/scrobble/hardcover-oauth';
import type { FetchLike } from '../src/upstream';

// M92: signing in to Hardcover against a mocked Hardcover (its OAuth server and GraphQL API).

const SECRET = 'test-secret-that-is-long-enough-1234567890';
const CLIENT_ID = 'client-id-for-tests';
// Long and odd, so it can't turn up in random base64url output by chance.
const CLIENT_SECRET = 'client secret 9d1f never shown';
const ORIGIN = 'https://addons.example';
const RETURN = 'lelap://addon';
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
};

/** Hardcover's OAuth server and API: codes, rotating refresh tokens with reuse detection. */
function mockHardcover(options: { scopes?: string[] } = {}) {
  const calls: Call[] = [];
  const codes = new Map<string, { challenge: string; redirect: string }>();
  let serial = 0;
  const live = { access: new Set<string>(), refresh: new Set<string>() };
  const spent = new Set<string>();
  const state = { refreshes: 0, revoked: false, scrobbled: [] as string[] };
  const issue = () => {
    serial += 1;
    const tokens = { access_token: `hc_at_${serial}`, refresh_token: `hc_rt_${serial}` };
    live.access.add(tokens.access_token);
    live.refresh.add(tokens.refresh_token);
    return { ...tokens, token_type: 'Bearer', expires_in: WEEK / 1000 };
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetch: FetchLike = async (url, init) => {
    const call = { url, method: init.method ?? 'GET', headers: init.headers, body: init.body };
    calls.push(call);
    if (url === 'https://api.hardcover.app/oauth2/token') {
      const expected = `Basic ${btoa(`${CLIENT_ID}:${encodeURIComponent(CLIENT_SECRET)}`)}`;
      if (call.headers.Authorization !== expected) return json({ error: 'invalid_client' }, 401);
      const form = new URLSearchParams(call.body);
      if (form.get('grant_type') === 'authorization_code') {
        const code = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (
          !code ||
          code.redirect !== form.get('redirect_uri') ||
          code.challenge !== (await challengeFor(form.get('code_verifier') ?? ''))
        )
          return json({ error: 'invalid_grant' }, 400);
        return json(issue());
      }
      if (form.get('grant_type') === 'refresh_token') {
        state.refreshes += 1;
        const token = form.get('refresh_token') ?? '';
        if (state.revoked || !live.refresh.has(token)) {
          // Reuse revokes the whole chain, as Hardcover does.
          if (spent.has(token)) {
            live.access.clear();
            live.refresh.clear();
          }
          return json({ error: 'invalid_grant' }, 400);
        }
        live.refresh.delete(token);
        spent.add(token);
        return json(issue());
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    if (url === 'https://api.hardcover.app/v1/graphql') {
      const bearer = (call.headers.authorization ?? '').replace(/^Bearer /, '');
      if (state.revoked || !live.access.has(bearer))
        return json({ errors: [{ message: 'invalid jwt' }] });
      const { query } = JSON.parse(call.body ?? '{}') as { query: string };
      if (query.includes('query Me')) {
        if (options.scopes && !options.scopes.includes('read:me:content'))
          return json({ error: 'insufficient_scope', scope: 'read:me:content' }, 403);
        return json({ data: { me: [{ id: 7, username: 'reader' }] } });
      }
      if (query.includes('query Lists'))
        return json({ data: { mine: [], followed: [], featured: [] } });
      if (query.includes('query Edition')) return json({ data: { editions: [{ book_id: 42 }] } });
      if (query.includes('query UserBook')) return json({ data: { user_books: [] } });
      if (query.includes('insert_user_book(')) {
        state.scrobbled.push(bearer);
        return json({ data: { insert_user_book: { id: 500, error: null } } });
      }
      if (query.includes('insert_user_book_read'))
        return json({ data: { insert_user_book_read: { id: 900, error: null } } });
      return json({ errors: [{ message: `unexpected ${query}` }] });
    }
    return new Response('not found', { status: 404 });
  };
  /** What hardcover.app does when the listener allows Lelap in. */
  const allow = (authorize: URL) => {
    const code = `code-${codes.size + 1}-${serial}`;
    codes.set(code, {
      challenge: authorize.searchParams.get('code_challenge') ?? '',
      redirect: authorize.searchParams.get('redirect_uri') ?? '',
    });
    const back = new URL(authorize.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', authorize.searchParams.get('state') ?? '');
    back.searchParams.set('iss', 'https://api.hardcover.app');
    return back;
  };
  return { fetch, calls, allow, state, live };
}

function setup(
  options: {
    clientSecret?: string;
    grants?: boolean;
    scopes?: string[];
    clock?: { now: number };
  } = {},
) {
  const hardcover = mockHardcover(options.scopes ? { scopes: options.scopes } : {});
  const clock = options.clock ?? { now: Date.UTC(2026, 10, 19) };
  const store = memoryGrantStore();
  const app = createApp(
    {
      fetch: hardcover.fetch,
      now: () => clock.now,
      ...(options.grants === false
        ? {}
        : { grants: (refresh) => localGrants(store, refresh, () => clock.now) }),
    },
    {
      CONFIG_SECRET: SECRET,
      HARDCOVER_CLIENT_ID: CLIENT_ID,
      ...(options.clientSecret === '' ? {} : { HARDCOVER_CLIENT_SECRET: CLIENT_SECRET }),
    },
  );
  const get = (path: string, cookie?: string) =>
    app.fetch(
      new Request(path.startsWith('http') ? path : `${ORIGIN}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
      }),
    );
  return { app, hardcover, clock, store, get };
}

const cookieOf = (response: Response) => (response.headers.get('Set-Cookie') ?? '').split(';')[0];

/** The button, Hardcover's consent, the callback, the rows page and Save: the add-on address. */
async function signIn(s: ReturnType<typeof setup>) {
  const start = await s.get(`/hardcover/oauth/start?return=${encodeURIComponent(RETURN)}`);
  const cookie = cookieOf(start);
  const authorize = new URL(start.headers.get('Location') ?? '');
  const back = s.hardcover.allow(authorize);
  const callback = await s.get(back.href, cookie);
  const next = callback.headers.get('Location') ?? '';
  const rows = await s.get(next);
  const html = await rows.text();
  const draft = /name="draft" value="([^"]+)"/.exec(html)?.[1] ?? '';
  const form = new URLSearchParams({ draft, return: RETURN });
  for (const [, name, value] of html.matchAll(
    /type="checkbox" name="([^"]+)" id="[^"]+" value="([^"]+)" checked/g,
  ))
    form.append(name ?? '', value ?? '');
  const saved = await s.app.fetch(
    new Request(`${ORIGIN}${next.replace(/\?.*$/, '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }),
  );
  const handBack = new URL(saved.headers.get('Location') ?? 'about:blank');
  return {
    start,
    cookie,
    authorize,
    callback,
    next,
    saved,
    manifestUrl: handBack.searchParams.get('manifest') ?? '',
  };
}

const progress = (): ScrobbleEvent => ({
  eventId: `evt-${Math.random().toString(36).slice(2, 12)}`,
  event: 'progress',
  at: Date.UTC(2026, 10, 19, 9),
  item: { type: 'audiobook', name: 'Walden', externalIds: { isbn: '9780141036144' } },
  positionMs: 600_000,
});

const scrobble = (s: ReturnType<typeof setup>, manifestUrl: string) =>
  s.app.fetch(
    new Request(manifestUrl.replace(/manifest\.json$/, 'scrobble'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [progress()] }),
    }),
  );

describe('Hardcover sign-in', () => {
  it('offers the sign-in first, keeping the token form, only when the server can', async () => {
    const on = await (await setup().get(`/hardcover/configure?return=${RETURN}`)).text();
    expect(on).toContain(
      `href="/hardcover/oauth/start?return=${encodeURIComponent(RETURN)}">Sign in with Hardcover</a>`,
    );
    expect(on).toContain('Or paste a token you make yourself');
    expect(on).toContain('name="token"');
    expect(on).not.toContain(CLIENT_SECRET);

    for (const off of [setup({ clientSecret: '' }), setup({ grants: false })]) {
      const html = await (await off.get('/hardcover/configure')).text();
      expect(html).not.toContain('Sign in with Hardcover');
      expect(html).toContain('name="token"');
      expect((await off.get('/hardcover/oauth/start')).status).not.toBe(303);
    }
  });

  it('sends the listener to Hardcover with PKCE, state and exactly the scopes it uses', async () => {
    const s = setup();
    const start = await s.get(`/hardcover/oauth/start?return=${encodeURIComponent(RETURN)}`);
    expect(start.status).toBe(303);
    expect(start.headers.get('Cache-Control')).toBe('no-store');
    const authorize = new URL(start.headers.get('Location') ?? '');
    expect(authorize.origin + authorize.pathname).toBe('https://hardcover.app/oauth2/authorize');
    const params = Object.fromEntries(authorize.searchParams);
    expect(params).toMatchObject({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: `${ORIGIN}/hardcover/oauth/callback`,
      scope: 'read:me:content read:library write:library read:catalog read:lists',
      code_challenge_method: 'S256',
    });
    expect(params.state).toMatch(/^[\w-]{43}$/);
    expect(params.code_challenge).toMatch(/^[\w-]{43}$/);
    expect(authorize.href).not.toContain(CLIENT_SECRET);
    const cookie = start.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^lelap_hardcover_signin=e2\.[\w-]+; Path=\/hardcover\/oauth;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    // The verifier stays sealed in the cookie.
    expect(cookie).not.toContain(params.state);
  });

  it('signs in, asks for the rows, and hands an address without tokens back to the app', async () => {
    const s = setup();
    const flow = await signIn(s);
    expect(flow.callback.status).toBe(303);
    expect(flow.callback.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(flow.next).toMatch(
      new RegExp(`^/hardcover/e2\\.[\\w-]+/configure\\?return=${encodeURIComponent(RETURN)}$`),
    );
    expect(flow.saved.status).toBe(303);
    expect(flow.manifestUrl).toMatch(
      /^https:\/\/addons\.example\/hardcover\/e2\.[\w-]+\/manifest\.json$/,
    );
    // The code went to Hardcover with the verifier, under HTTP Basic, never in a URL.
    const exchange = s.hardcover.calls.find((c) => c.url.endsWith('/oauth2/token'));
    expect(exchange?.method).toBe('POST');
    expect(new URLSearchParams(exchange?.body).get('grant_type')).toBe('authorization_code');
    // No token anywhere the browser or the app sees.
    for (const seen of [flow.next, flow.manifestUrl, flow.saved.headers.get('Location') ?? ''])
      expect(seen).not.toMatch(/hc_at_|hc_rt_|client-id|9d1f/);
    // One grant kept, sealed.
    expect(s.store.size()).toBe(1);

    expect((await scrobble(s, flow.manifestUrl)).status).toBe(200);
    expect(s.hardcover.state.scrobbled).toEqual(['hc_at_1']);
  });

  it('refuses a callback with an unknown state, no cookie, another issuer or a late return', async () => {
    const s = setup();
    const start = await s.get('/hardcover/oauth/start');
    const cookie = cookieOf(start);
    const back = s.hardcover.allow(new URL(start.headers.get('Location') ?? ''));

    const forged = new URL(back);
    forged.searchParams.set('state', 'x'.repeat(43));
    const noIssuer = new URL(back);
    noIssuer.searchParams.delete('iss');
    const otherIssuer = new URL(back);
    otherIssuer.searchParams.set('iss', 'https://evil.example');
    for (const [url, withCookie] of [
      [forged, cookie],
      [back, undefined],
      [back, 'lelap_hardcover_signin=e2.forged'],
      [noIssuer, cookie],
      [otherIssuer, cookie],
    ] as const) {
      const response = await s.get(url.href, withCookie);
      expect(response.status).toBe(400);
      expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    }
    s.clock.now += 11 * 60 * 1000;
    const late = await s.get(back.href, cookie);
    expect(await late.text()).toContain('took too long');
    // Nothing was traded or kept.
    expect(s.hardcover.calls.some((c) => c.url.endsWith('/oauth2/token'))).toBe(false);
    expect(s.store.size()).toBe(0);
  });

  it('says so when the listener declines on Hardcover', async () => {
    const s = setup();
    const start = await s.get('/hardcover/oauth/start');
    const back = new URL(`${ORIGIN}/hardcover/oauth/callback`);
    back.searchParams.set('error', 'access_denied');
    back.searchParams.set(
      'state',
      new URL(start.headers.get('Location') ?? '').searchParams.get('state') ?? '',
    );
    const response = await s.get(back.href, cookieOf(start));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('didn’t allow Lelap in');
  });

  it('renews the access token a day before it runs out, with the newest refresh token', async () => {
    const s = setup();
    const { manifestUrl } = await signIn(s);
    s.clock.now += WEEK - RENEW_BEFORE_MS + 1000;
    expect((await scrobble(s, manifestUrl)).status).toBe(200);
    s.clock.now += WEEK;
    expect((await scrobble(s, manifestUrl)).status).toBe(200);
    expect(s.hardcover.state.refreshes).toBe(2);
    // Each refresh used the token from the one before; none was sent twice.
    const sent = s.hardcover.calls
      .filter((c) => c.url.endsWith('/oauth2/token'))
      .map((c) => new URLSearchParams(c.body).get('refresh_token'))
      .filter(Boolean);
    expect(sent).toEqual(['hc_rt_1', 'hc_rt_2']);
    expect(s.hardcover.state.scrobbled.at(-1)).toBe('hc_at_3');
  });

  it('asks to sign in again once the listener revokes Lelap on Hardcover', async () => {
    const s = setup();
    const { manifestUrl } = await signIn(s);
    s.hardcover.state.revoked = true;
    const response = await scrobble(s, manifestUrl);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toContain('Sign in to Hardcover');
    expect(s.store.size()).toBe(0);
  });

  it('renews early when Hardcover turns down a token that should still work', async () => {
    const s = setup();
    const { manifestUrl } = await signIn(s);
    s.hardcover.live.access.clear();
    expect((await scrobble(s, manifestUrl)).status).toBe(200);
    expect(s.hardcover.state.refreshes).toBe(1);
  });

  it('refuses a signed-in address on a server without sign-in', async () => {
    const s = setup();
    const { manifestUrl } = await signIn(s);
    const plain = createApp({ fetch: s.hardcover.fetch }, { CONFIG_SECRET: SECRET });
    const response = await plain.fetch(
      new Request(manifestUrl.replace(/manifest\.json$/, 'scrobble'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [progress()] }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('says which permission is missing when the app at Hardcover lacks read:me:content', async () => {
    const s = setup({ scopes: ['read:library'] });
    const start = await s.get('/hardcover/oauth/start');
    const back = s.hardcover.allow(new URL(start.headers.get('Location') ?? ''));
    const callback = await s.get(back.href, cookieOf(start));
    const page = await (await s.get(callback.headers.get('Location') ?? '')).text();
    expect(page).toContain('read:me:content');
  });
});

describe('grant renewal', () => {
  const tokens = (n: number, expiresAt: number): Tokens => ({
    access: `at${n}`,
    refresh: `rt${n}`,
    expiresAt,
  });

  it('renews once for requests that arrive together', async () => {
    const store = memoryGrantStore();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = async () => {
      calls += 1;
      await gate;
      return tokens(2, 10 * WEEK);
    };
    const grants = localGrants(store, refresh, () => WEEK);
    const ref = await grants.create(tokens(1, WEEK + 1000));
    const together = Promise.all([grants.access(ref), grants.access(ref), grants.access(ref)]);
    release();
    expect(await together).toEqual(['at2', 'at2', 'at2']);
    expect(calls).toBe(1);
    expect(await grants.access(ref)).toBe('at2');
    expect(calls).toBe(1);
  });

  it('keeps the old token while Hardcover is down, and refuses a wrong key', async () => {
    const store = memoryGrantStore();
    const refresh = async (): Promise<Tokens> => {
      throw new Error('down');
    };
    const grants = localGrants(store, refresh, () => 0);
    const ref = await grants.create(tokens(1, DAY / 2));
    expect(await grants.access(ref)).toBe('at1');
    await expect(grants.access({ ...ref, key: 'A'.repeat(43) })).rejects.toBeInstanceOf(GrantGone);
    // A wrong key leaves the record alone.
    expect(store.size()).toBe(1);
    const access = grantAccess(store, refresh, () => DAY);
    await expect(access(ref)).rejects.toThrow('down');
  });

  it('never keeps a token in the clear', async () => {
    const store = memoryGrantStore();
    const grants = localGrants(
      store,
      async () => tokens(2, WEEK),
      () => 0,
    );
    const ref = await grants.create(tokens(1, WEEK));
    const sealed = (await store.get(ref.id)) ?? '';
    expect(sealed).not.toMatch(/at1|rt1/);
    expect(sealed).not.toContain(ref.key);
  });
});
