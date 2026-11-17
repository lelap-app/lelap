// Shared by the Worker and `scripts/ota.mts`, which writes these files in the release workflow.
// No imports, so Node can run it with type stripping.

/** One update per channel and runtime version: the manifest text exactly as signed. */
export type Published = {
  manifest: string;
  /** Base64 RSA-SHA256 (PKCS #1 v1.5) signature of `manifest`'s UTF-8 bytes. */
  signature: string;
  /** Matches `codeSigningMetadata.keyid` in the app's config. */
  keyId: string;
};

/** Channel names and runtime versions become storage keys, so they stay plain. */
export const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}$/;

export const CHANNELS = ['production', 'beta'] as const;

export const publishedKey = (channel: string, runtimeVersion: string): string =>
  `ota/channels/${channel}/${runtimeVersion}.json`;

export function parsePublished(text: string): Published | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const { manifest, signature, keyId } = value as Record<string, unknown>;
    if (typeof manifest !== 'string' || typeof signature !== 'string') return null;
    if (typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) return null;
    if (!/^[A-Za-z0-9+/]+=*$/.test(signature)) return null;
    return { manifest, signature, keyId };
  } catch {
    return null;
  }
}

/** The update ID inside a manifest, or null when the manifest is unreadable. */
export function manifestId(manifest: string): string | null {
  try {
    const value: unknown = JSON.parse(manifest);
    const id = (value as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}
