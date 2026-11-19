import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  GRANT_LIFETIME_MS,
  type GrantStore,
  isGrantId,
} from '../../../services/catalog/src/scrobble/hardcover-grants';

// Hardcover sign-ins on Docker (M92): one file per grant, each holding tokens sealed with a key
// only the listener's add-on address has. One process serves the catalog, so the renewal lock in
// memory (grantAccess) is enough.

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export function grantFiles(dir: string, now: () => number = Date.now): GrantStore {
  const file = (id: string) => {
    if (!isGrantId(id)) throw new Error('Bad grant ID');
    return join(dir, `${id}.grant`);
  };
  let swept = 0;
  // Grants unused for longer than a refresh token lasts can never be renewed: drop them.
  const sweep = async () => {
    if (now() - swept < 24 * 60 * 60 * 1000) return;
    swept = now();
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith('.grant')) continue;
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info && now() - info.mtimeMs > GRANT_LIFETIME_MS) await rm(path, { force: true });
    }
  };
  return {
    get: async (id) => {
      try {
        return (await readFile(file(id), 'utf8')).trim() || null;
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    put: async (id, sealed) => {
      const target = file(id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // Written whole, then renamed, so a crash never leaves half a record.
      const draft = `${target}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(draft, sealed, { mode: 0o600 });
      await rename(draft, target);
      await sweep().catch(() => undefined);
    },
    delete: async (id) => {
      await rm(file(id), { force: true });
    },
  };
}
