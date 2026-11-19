import { AddonError, allowedReturn, decodeConfig, encodeConfig, PAGE_STYLE } from '@lelap/sdk';

import type { Grants } from './hardcover-grants';
import {
  challengeFor,
  HARDCOVER_OAUTH,
  type HardcoverOAuth,
  OAUTH_SCOPES,
  randomToken,
} from './hardcover-oauth';
import { PAGE_CSP } from './mount';

// The browser half of signing in to Hardcover (M92):
//   {base}/oauth/start      makes `state` and a PKCE verifier, keeps them in a sealed cookie
//                           for this browser and sends the listener to Hardcover
//   {base}/oauth/callback   checks `state` and `iss`, trades the code for tokens, keeps them
//                           (hardcover-grants.ts), and opens the second configure page with
//                           the new add-on address, which hands it back to the app
// The redirect URI is this host's: Hardcover only sends listeners back to one registered exactly.

const COOKIE = 'lelap_hardcover_signin';
/** How long a sign-in may take, from the button to coming back. */
export const SIGN_IN_MS = 10 * 60 * 1000;

export type SignInOptions = {
  basePath: string;
  /** The add-on's manifest ID, which its sealed settings are bound to. */
  addonId: string;
  /** `CONFIG_SECRET`. */
  secret: string;
  oauth: HardcoverOAuth;
  grants: Grants;
  /** The settings to seal for a new grant, as the configure page keeps them. */
  settingsFor: (grant: { id: string; key: string }) => Record<string, string>;
  returnOrigins?: string[];
  /**
   * The public origin, such as `https://catalog.example.org`, when requests arrive under another
   * (Docker behind a proxy that ends TLS). Defaults to the request's own.
   */
  origin?: string;
  now?: () => number;
  onError?: (error: unknown) => void;
};

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

function problemPage(message: string, again: string, clear: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sign-in failed</title><style>${PAGE_STYLE}</style></head><body><main><h1>Not signed in</h1><p class="error" role="alert">${escape(message)}</p><p><a class="button" href="${escape(again)}">Start again</a></p></main></body></html>`;
  return new Response(html, {
    status: 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PAGE_CSP,
      'Set-Cookie': clear,
      ...NO_STORE,
    },
  });
}

/** Compares two strings in time that doesn't depend on where they differ. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return null;
}

/** Serves the two sign-in paths; null for anything else. */
export function hardcoverSignIn(
  options: SignInOptions,
): (request: Request) => Promise<Response | null> {
  const { basePath, oauth, grants, secret } = options;
  const now = options.now ?? Date.now;
  // The cookie's settings are bound to this purpose, so no other sealed value passes for them.
  const purpose = `${options.addonId}\nsign-in`;
  const cookiePath = `${basePath}/oauth`;
  const clear = `${COOKIE}=; Path=${cookiePath}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  const allowed = (target: string | null) =>
    target && allowedReturn(target, options.returnOrigins) ? target : '';
  const configureUrl = (returnTo: string) =>
    `${basePath}/configure${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ''}`;

  async function start(url: URL): Promise<Response> {
    const returnTo = allowed(url.searchParams.get('return'));
    const state = randomToken(32);
    const verifier = randomToken(32);
    const redirectUri = `${options.origin ?? url.origin}${basePath}/oauth/callback`;
    const sealed = await encodeConfig(
      { state, verifier, redirectUri, returnTo, until: String(now() + SIGN_IN_MS) },
      secret,
      purpose,
    );
    const authorize = new URL(HARDCOVER_OAUTH.authorize);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: oauth.clientId,
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES.join(' '),
      state,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return new Response(null, {
      status: 303,
      headers: {
        Location: authorize.href,
        // Lax: Hardcover's redirect back is a top-level GET, which still carries it.
        'Set-Cookie': `${COOKIE}=${sealed}; Path=${cookiePath}; Max-Age=${SIGN_IN_MS / 1000}; HttpOnly; Secure; SameSite=Lax`,
        ...NO_STORE,
      },
    });
  }

  async function callback(request: Request, url: URL): Promise<Response> {
    const raw = cookieValue(request);
    const kept = raw ? await decodeConfig(raw, secret, purpose) : null;
    const returnTo = typeof kept?.returnTo === 'string' ? allowed(kept.returnTo) : '';
    const fail = (message: string) => problemPage(message, configureUrl(returnTo), clear);
    const state = url.searchParams.get('state') ?? '';
    // Only the state this browser was sent off with is known; any other is refused.
    if (
      !kept ||
      typeof kept.state !== 'string' ||
      typeof kept.verifier !== 'string' ||
      typeof kept.redirectUri !== 'string' ||
      !same(state, kept.state)
    )
      return fail(
        'This sign-in was not started here, or it was started in another browser. Start again from the add-on’s settings.',
      );
    if (!(Number(kept.until) > now())) return fail('The sign-in took too long. Start again.');
    const error = url.searchParams.get('error');
    if (error)
      return fail(
        error === 'access_denied'
          ? 'Hardcover says you didn’t allow Lelap in. To set the add-on up, start again and choose Allow, or paste a token instead.'
          : 'Hardcover could not sign you in. Start again.',
      );
    // Mix-up defence (RFC 9207): Hardcover always names itself.
    if (url.searchParams.get('iss') !== HARDCOVER_OAUTH.issuer)
      return fail('The answer did not come from Hardcover. Start again.');
    const code = url.searchParams.get('code');
    if (!code) return fail('Hardcover sent no sign-in code. Start again.');
    let token: string;
    try {
      const tokens = await oauth.exchange(code, kept.verifier, kept.redirectUri);
      const grant = await grants.create(tokens);
      token = await encodeConfig(options.settingsFor(grant), secret, options.addonId);
    } catch (problem) {
      if (!(problem instanceof AddonError)) options.onError?.(problem);
      return fail('Hardcover did not finish the sign-in. Start again in a moment.');
    }
    // The configure page of the new address asks for the rows next, then returns to the app.
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${basePath}/${token}/configure${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ''}`,
        'Set-Cookie': clear,
        ...NO_STORE,
      },
    });
  }

  return async (request) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    if (url.pathname === `${basePath}/oauth/start`) return start(url);
    if (url.pathname === `${basePath}/oauth/callback`) return callback(request, url);
    return null;
  };
}
