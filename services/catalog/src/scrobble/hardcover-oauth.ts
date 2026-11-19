import { AddonError } from '@lelap/sdk';

import type { FetchLike } from '../upstream';

// Signing in to Hardcover with OAuth (M92): the authorization code flow with PKCE, as a
// confidential client. Endpoints and token rules from Hardcover's docs,
// https://docs.hardcover.app/api/oauth/ and its discovery document,
// https://api.hardcover.app/.well-known/oauth-authorization-server.

export const HARDCOVER_OAUTH = {
  /** What Hardcover names itself in the callback's `iss` (RFC 9207). */
  issuer: 'https://api.hardcover.app',
  authorize: 'https://hardcover.app/oauth2/authorize',
  token: 'https://api.hardcover.app/oauth2/token',
} as const;

/** Where a listener sees and revokes the apps they let in. */
export const AUTHORIZED_APPS_URL = 'https://hardcover.app/account/api/authorized-apps';

/**
 * What the add-on asks for: `me` (read:me:content), shelves and reads (read:library,
 * write:library), books, search and trending (read:catalog), lists (read:lists).
 */
export const OAUTH_SCOPES = [
  'read:me:content',
  'read:library',
  'write:library',
  'read:catalog',
  'read:lists',
];

/** Access tokens last a week; an answer without `expires_in` is taken as that. */
const DEFAULT_LIFETIME_S = 7 * 24 * 60 * 60;

export type Tokens = { access: string; refresh: string; expiresAt: number };

/** Hardcover refused the refresh token: revoked, run out or used twice. Sign in again. */
export class GrantGone extends AddonError {
  constructor() {
    super(401, 'Hardcover signed Lelap out. Sign in to Hardcover again in the add-on’s settings.');
  }
}

export type HardcoverOAuth = {
  clientId: string;
  /** Trades the callback's code for tokens. */
  exchange: (code: string, verifier: string, redirectUri: string) => Promise<Tokens>;
  /** New tokens for a refresh token, which stops working once used; throws `GrantGone`. */
  refresh: (refreshToken: string) => Promise<Tokens>;
};

/** Null unless both the client ID and its secret are set: then sign-in is off. */
export function hardcoverOAuth(
  fetch: FetchLike,
  options: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    userAgent: string;
    now?: () => number;
  },
): HardcoverOAuth | null {
  const clientId = options.clientId?.trim();
  const clientSecret = options.clientSecret?.trim();
  if (!clientId || !clientSecret) return null;
  const now = options.now ?? Date.now;
  // HTTP Basic with both parts form-encoded first (RFC 6749, 2.3.1).
  const basic = btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`);
  const post = async (form: Record<string, string>): Promise<Tokens> => {
    let response: Response;
    try {
      response = await fetch(HARDCOVER_OAUTH.token, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': options.userAgent,
        },
        body: new URLSearchParams(form).toString(),
        // Generous: a refresh cut off after Hardcover answered has spent its token.
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new AddonError(504, 'Hardcover did not answer. Try again in a moment.');
    }
    // The body may hold tokens: never put it in an error or a log.
    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
    } | null;
    if (response.status === 400 || response.status === 401) {
      if (body?.error === 'invalid_grant') throw new GrantGone();
      throw new AddonError(502, `Hardcover refused the sign-in (${errorCode(body?.error)})`);
    }
    if (!response.ok) throw new AddonError(502, `Hardcover answered ${response.status}`);
    const access = body?.access_token;
    const refresh = body?.refresh_token;
    if (typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh)
      throw new AddonError(502, 'Hardcover sent no tokens');
    const lifetime =
      typeof body?.expires_in === 'number' && body.expires_in > 0
        ? body.expires_in
        : DEFAULT_LIFETIME_S;
    return { access, refresh, expiresAt: now() + lifetime * 1000 };
  };
  return {
    clientId,
    exchange: (code, verifier, redirectUri) =>
      post({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    refresh: (refreshToken) => post({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  };
}

/** An OAuth error code is a short ASCII word; anything else isn't echoed. */
const errorCode = (value: unknown) =>
  typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : 'unknown';

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `bytes` random bytes as base64url: 32 make a PKCE verifier of 43 characters. */
export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** The PKCE `code_challenge` for a verifier (S256, the only method Hardcover takes). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
