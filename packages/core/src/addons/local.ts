import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import { localAddonCode } from '../schema';

// Add-ons that run inside the app (M38): one JavaScript file in a sandbox with no network of its
// own. The app fetches only from the hosts the add-on declares, and talks to it through the same
// routes as a web add-on, under a `lelap-local://` address.

export const LOCAL_SCHEME = 'lelap-local://';

export const localAddonUrl = (id: string) =>
  `${LOCAL_SCHEME}${encodeURIComponent(id)}/manifest.json`;

export const isLocalAddonUrl = (url: string) => url.startsWith(LOCAL_SCHEME);

/** The add-on's manifest URL and the route path within it, for a `lelap-local://` request URL. */
export function splitLocalUrl(url: string): { manifestUrl: string; path: string } | null {
  if (!isLocalAddonUrl(url)) return null;
  const rest = url.slice(LOCAL_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return {
    manifestUrl: `${LOCAL_SCHEME}${rest.slice(0, slash)}/manifest.json`,
    path: rest.slice(slash + 1),
  };
}

/**
 * Whether a sandboxed add-on may fetch `url`: http(s) only, to a declared host. A host is
 * `name`, `name:port`, or `*.suffix` for any name under it (not the suffix itself).
 */
export function hostAllowed(url: string, hosts: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const name = parsed.hostname.toLowerCase();
  // A default port counts as written out, so `nas.local:80` allows `http://nas.local/`.
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return hosts.some((entry) => {
    const e = entry.trim().toLowerCase();
    const [pattern, wantPort] = e.startsWith('[')
      ? [e.slice(0, e.indexOf(']') + 1), e.slice(e.indexOf(']') + 2) || null]
      : [e.split(':')[0] ?? '', e.split(':')[1] ?? null];
    if (wantPort !== null && wantPort !== port) return false;
    if (pattern.startsWith('*.'))
      return name.endsWith(pattern.slice(1)) && name !== pattern.slice(2);
    return name === pattern;
  });
}

export function saveLocalAddonCode(
  db: Db,
  row: { url: string; sourceUrl: string; code: string; sha256: string; now: number },
): void {
  const set = { sourceUrl: row.sourceUrl, code: row.code, sha256: row.sha256, updatedAt: row.now };
  db.insert(localAddonCode)
    .values({ url: row.url, ...set })
    .onConflictDoUpdate({ target: localAddonCode.url, set })
    .run();
}

export function getLocalAddonCode(
  db: Db,
  url: string,
): { code: string; sha256: string; sourceUrl: string } | null {
  return (
    db
      .select({
        code: localAddonCode.code,
        sha256: localAddonCode.sha256,
        sourceUrl: localAddonCode.sourceUrl,
      })
      .from(localAddonCode)
      .where(eq(localAddonCode.url, url))
      .get() ?? null
  );
}

export function deleteLocalAddonCode(db: Db, url: string): void {
  db.delete(localAddonCode).where(eq(localAddonCode.url, url)).run();
}
