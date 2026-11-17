// A listener's settings for a scrobble add-on (tokens, passwords) travel inside the add-on URL,
// sealed with a key only this server has, so they are never stored here and a URL that leaks
// from a log or a screenshot does not show them. AES-256-GCM; the add-on's name is the
// associated data, so a sealed Hardcover token is not accepted by the gPodder add-on.

const PREFIX = 'v1.';
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function keyFor(secret: string): Promise<CryptoKey> {
  // The secret may be any long random string; hashing gives the 256-bit key.
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export type Sealer = {
  seal: (value: unknown) => Promise<string>;
  /** The value, or null for anything not sealed by this key for this add-on. */
  open: (sealed: string) => Promise<unknown>;
};

/** Null without a secret of at least 32 characters: the add-on then can't be configured. */
export function createSealer(secret: string | undefined, addon: string): Sealer | null {
  if (!secret || secret.trim().length < 32) return null;
  const key = keyFor(secret.trim());
  const additionalData = encoder.encode(addon);
  return {
    async seal(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData },
          await key,
          encoder.encode(JSON.stringify(value)),
        ),
      );
      const out = new Uint8Array(iv.length + cipher.length);
      out.set(iv);
      out.set(cipher, iv.length);
      return PREFIX + base64url(out);
    },
    async open(sealed) {
      if (!sealed.startsWith(PREFIX) || sealed.length > 4096) return null;
      const bytes = fromBase64url(sealed.slice(PREFIX.length));
      if (!bytes || bytes.length < 12 + 16) return null;
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData },
          await key,
          bytes.slice(12),
        );
        return JSON.parse(new TextDecoder().decode(plain)) as unknown;
      } catch {
        return null;
      }
    },
  };
}
