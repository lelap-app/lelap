import { open, type Random, seal } from './sync/crypto';

/**
 * Seals the few values that unlock something elsewhere (the sync group key, server passwords)
 * before they are written to the database. On Android the key lives in the Keystore, so a copy of
 * the database, such as a backup, holds only ciphertext.
 */
export type SecretBox = {
  seal: (text: string) => string;
  /** The plaintext, or null when this device can't open it (a backup restored on a new phone). */
  open: (text: string) => string | null;
  /** False where there is no key store (the web build): values stay as they are. */
  sealing: boolean;
};

const PREFIX = 'sec1:';
const CONTEXT = 'lelap secret v1';

export const isSealed = (text: string) => text.startsWith(PREFIX);

/** Stores values as they are and can't open sealed ones. */
export const plainBox: SecretBox = {
  seal: (text) => text,
  open: (text) => (isSealed(text) ? null : text),
  sealing: false,
};

/** XChaCha20-Poly1305 with a 32-byte key; values written before sealing pass through. */
export function createSecretBox(key: Uint8Array, random: Random): SecretBox {
  return {
    seal: (text) => `${PREFIX}${seal(key, CONTEXT, text, random)}`,
    open: (text) => (isSealed(text) ? open(key, CONTEXT, text.slice(PREFIX.length)) : text),
    sealing: true,
  };
}

// One per app: set once at start, before the database is read.
let current: SecretBox = plainBox;

export function setSecretBox(box: SecretBox): void {
  current = box;
}

export const secretBox = (): SecretBox => current;
