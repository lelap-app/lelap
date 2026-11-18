import { readdirSync, readFileSync } from 'node:fs';

import { getPlatformProxy } from 'wrangler';

const here = (path: string) => decodeURIComponent(new URL(path, import.meta.url).pathname);
const migrations = here('../migrations/');

/** The statements of a migration file, for D1's batch (its `exec` wants one per line). */
export function statements(name: string): string[] {
  return readFileSync(`${migrations}${name}`, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const migrationNames = () =>
  readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort();

/**
 * D1 as the Worker sees it: wrangler runs the binding from wrangler.toml in workerd (Miniflare),
 * in memory. `@cloudflare/vitest-pool-workers` does not support Vitest 5 yet.
 */
export async function localD1(apply = migrationNames()) {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: here('../wrangler.toml'),
    persist: false,
  });
  const db = proxy.env.DB;
  const migrate = async (names: string[]) => {
    for (const name of names) await db.batch(statements(name).map((sql) => db.prepare(sql)));
  };
  await migrate(apply);
  return {
    db,
    migrate,
    /** Empties every table between tests. */
    clear: () =>
      db.batch(
        ['messages', 'snapshot_parts', 'groups', 'pairings'].map((t) =>
          db.prepare(`DELETE FROM ${t}`),
        ),
      ),
    dispose: () => proxy.dispose(),
  };
}
