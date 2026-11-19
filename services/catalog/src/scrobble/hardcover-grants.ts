import { AddonError } from '@lelap/sdk';

import { base64url, fromBase64url, GrantGone, randomToken, type Tokens } from './hardcover-oauth';

// A listener's Hardcover sign-in (M92). Hardcover's refresh tokens change on every use and a
// token used twice revokes the sign-in, so they can't live in the add-on's address, which the app
// keeps and syncs as it is. The server keeps them, encrypted with a key that only the listener's
// sealed address holds; the address names the grant and carries its key.

/** Kept in the add-on's sealed settings. */
export type GrantRef = { id: string; key: string };

/** Sealed token records by grant ID. Workers: a Durable Object each; Docker: files. */
export type GrantStore = {
  get: (id: string) => Promise<string | null>;
  put: (id: string, sealed: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
};

export type Grants = {
  create: (tokens: Tokens) => Promise<GrantRef>;
  /**
   * An access token that works for a while yet, renewed when it has less than a day left.
   * `refused` is one Hardcover just turned down, which is renewed whatever its age.
   */
  access: (ref: GrantRef, refused?: string) => Promise<string>;
};

/** Renewed this long before the access token (a week) runs out, so use rarely meets an old one. */
export const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
/** Hardcover's refresh tokens last six months; a grant unused for longer is dropped. */
export const GRANT_LIFETIME_MS = 190 * 24 * 60 * 60 * 1000;

export const isGrantId = (id: string) => /^[A-Za-z0-9_-]{22}$/.test(id);
export const isGrantKey = (key: string) => /^[A-Za-z0-9_-]{43}$/.test(key);

const encoder = new TextEncoder();
const AAD = encoder.encode('lelap hardcover grant v1');

const keyOf = (key: string) => {
  const raw = fromBase64url(key);
  if (!raw || raw.length !== 32) return null;
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

export async function sealTokens(tokens: Tokens, key: string): Promise<string> {
  const cryptoKey = await keyOf(key);
  if (!cryptoKey) throw new Error('Bad grant key');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      cryptoKey,
      encoder.encode(JSON.stringify(tokens)),
    ),
  );
  return `${base64url(iv)}.${base64url(cipher)}`;
}

/** The tokens, or null for a record this key didn't seal. */
export async function openTokens(sealed: string, key: string): Promise<Tokens | null> {
  const [ivText, cipherText] = sealed.split('.');
  const iv = fromBase64url(ivText ?? '');
  const cipher = fromBase64url(cipherText ?? '');
  const cryptoKey = await keyOf(key);
  if (!iv || iv.length !== 12 || !cipher || !cryptoKey) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      cryptoKey,
      cipher,
    );
    const value = JSON.parse(new TextDecoder().decode(plain)) as Partial<Tokens>;
    if (
      typeof value.access !== 'string' ||
      typeof value.refresh !== 'string' ||
      typeof value.expiresAt !== 'number'
    )
      return null;
    return { access: value.access, refresh: value.refresh, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

/** Keeps new tokens under a fresh ID and key; only the returned ref can read them. */
export async function createGrant(store: GrantStore, tokens: Tokens): Promise<GrantRef> {
  const ref = { id: randomToken(16), key: randomToken(32) };
  await store.put(ref.id, await sealTokens(tokens, ref.key));
  return ref;
}

/**
 * Hands out access tokens and renews them. One renewal per grant at a time: a second request
 * waits for the first, since sending a refresh token twice would end the sign-in. On Workers
 * this runs inside the grant's Durable Object, the only place its tokens are read.
 */
export function grantAccess(
  store: GrantStore,
  refresh: (refreshToken: string) => Promise<Tokens>,
  now: () => number = Date.now,
): Grants['access'] {
  const running = new Map<string, Promise<string>>();
  const run = async (ref: GrantRef, refused: string | undefined): Promise<string> => {
    const sealed = await store.get(ref.id);
    if (!sealed) throw new GrantGone();
    const tokens = await openTokens(sealed, ref.key);
    // A wrong key is refused, not deleted: the record is still the real owner's.
    if (!tokens) throw new GrantGone();
    const turnedDown = refused !== undefined && refused === tokens.access;
    if (!turnedDown && tokens.expiresAt - now() > RENEW_BEFORE_MS) return tokens.access;
    let next: Tokens;
    try {
      next = await refresh(tokens.refresh);
    } catch (error) {
      if (error instanceof GrantGone) {
        await store.delete(ref.id);
        throw error;
      }
      // Hardcover is down: the old token serves while it lasts.
      if (!turnedDown && tokens.expiresAt > now()) return tokens.access;
      throw error;
    }
    await store.put(ref.id, await sealTokens(next, ref.key));
    return next.access;
  };
  return (ref, refused) => {
    const pending = running.get(ref.id);
    if (pending) return pending;
    const started = run(ref, refused).finally(() => running.delete(ref.id));
    running.set(ref.id, started);
    return started;
  };
}

export function localGrants(
  store: GrantStore,
  refresh: (refreshToken: string) => Promise<Tokens>,
  now?: () => number,
): Grants {
  return {
    create: (tokens) => createGrant(store, tokens),
    access: grantAccess(store, refresh, now),
  };
}

/** For tests, and a server that may forget sign-ins when it restarts. */
export function memoryGrantStore(): GrantStore & { size: () => number } {
  const records = new Map<string, string>();
  return {
    get: async (id) => records.get(id) ?? null,
    put: async (id, sealed) => {
      records.set(id, sealed);
    },
    delete: async (id) => {
      records.delete(id);
    },
    size: () => records.size,
  };
}

/** What a grant config says when this server keeps no sign-ins. */
export const NO_GRANTS = () =>
  new AddonError(401, 'This server can’t sign in to Hardcover. Set the add-on up with a token.');
