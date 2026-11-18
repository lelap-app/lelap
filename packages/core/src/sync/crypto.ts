import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Random bytes from the platform: expo-crypto in the app, `crypto.getRandomValues` elsewhere. */
export type Random = (n: number) => Uint8Array;

// Through noble's helpers, so the module type-checks without DOM types (the Kotlin module
// packages import core with ES library types only).
const encoder = { encode: utf8ToBytes };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** URL-safe base64 without padding; Hermes, browsers and Workers all lack one built in. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - c * 6)) & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = B64.indexOf(char);
    if (value < 0) throw new Error('Not base64url.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return new Uint8Array(bytes);
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Separate keys for sealing operations and for proving membership to the server. */
export function deriveKeys(groupKey: Uint8Array): { enc: Uint8Array; auth: Uint8Array } {
  return {
    enc: hkdf(sha256, groupKey, undefined, encoder.encode('lelap sync ops v1'), 32),
    auth: hkdf(sha256, groupKey, undefined, encoder.encode('lelap sync auth v1'), 32),
  };
}

/** The token a device shows the server; the server keeps only its SHA-256. */
export const authToken = (groupKey: Uint8Array) => toBase64Url(deriveKeys(groupKey).auth);

export const authHash = (token: string) => toHex(sha256(encoder.encode(token)));

/** XChaCha20-Poly1305 with a random 24-byte nonce; `context` is bound as associated data. */
export function seal(key: Uint8Array, context: string, plaintext: string, random: Random): string {
  const nonce = random(24);
  const sealed = xchacha20poly1305(key, nonce, encoder.encode(context)).encrypt(
    encoder.encode(plaintext),
  );
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce);
  out.set(sealed, nonce.length);
  return toBase64Url(out);
}

/** The plaintext, or null when the message was not sealed with this key and context. */
export function open(key: Uint8Array, context: string, message: string): string | null {
  try {
    const bytes = fromBase64Url(message);
    const plain = xchacha20poly1305(key, bytes.subarray(0, 24), encoder.encode(context)).decrypt(
      bytes.subarray(24),
    );
    return bytesToUtf8(plain);
  } catch {
    return null;
  }
}

// Crockford's base32: no I, L, O or U, so a code read aloud or typed is hard to get wrong.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;

/** A pairing code such as `7KQM-2XPA-9HRT`: 60 random bits, used once within ten minutes. */
export function newPairingCode(random: Random): string {
  const bytes = random(CODE_LENGTH);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b & 31]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** The code as typed, cleaned up, or null when it can't be one. */
export function normalizeCode(text: string): string | null {
  const chars = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (chars.length !== CODE_LENGTH || [...chars].some((c) => !CODE_ALPHABET.includes(c))) {
    return null;
  }
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** scrypt's cost for pairing codes. Changing it breaks pairing between app versions. */
export const PAIRING_COST = 2 ** 15;

let pairingCost = PAIRING_COST;

/**
 * Lowers scrypt's cost for tests only, which would otherwise spend most of their time here. Only
 * the test setup files call it; one known-answer test keeps the real cost covered.
 */
export function setPairingCostForTests(cost: number): void {
  pairingCost = cost;
}

/**
 * The server's lookup ID and the key that seals the group secret, both from the code through
 * scrypt, so neither the lookup ID nor the stored blob is cheap to search.
 */
export async function pairingKeys(code: string): Promise<{ lookup: string; key: Uint8Array }> {
  const out = await scryptAsync(encoder.encode(code), encoder.encode('lelap pairing v1'), {
    N: pairingCost,
    r: 8,
    p: 1,
    dkLen: 64,
  });
  return { lookup: toHex(out.subarray(0, 32)), key: out.slice(32) };
}
