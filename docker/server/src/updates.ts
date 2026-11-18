import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { createApp, type Storage } from '../../../services/updates/src/app';
import { adminFromEnv } from './admin';
import { port, serve } from './serve';

// The same layout as the downloads bucket: ota/channels/<channel>/<runtime>.json and the bundles.
const root = resolve(process.env.UPDATES_DIR ?? '/data');

async function read(key: string): Promise<Buffer | null> {
  const path = resolve(join(root, key));
  if (!path.startsWith(root + sep)) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

const folder: Storage = {
  text: async (key) => (await read(key))?.toString('utf8') ?? null,
  file: async (key) => {
    const bytes = await read(key);
    return bytes ? new Uint8Array(bytes) : null;
  },
};

const servicePort = port(8790);
serve(createApp(folder), servicePort, 'updates');

/** The published updates: one manifest per channel and runtime version. */
async function published(): Promise<(string | number)[][]> {
  const rows: (string | number)[][] = [];
  const channels = join(root, 'ota', 'channels');
  for (const channel of await readdir(channels).catch(() => [])) {
    for (const name of await readdir(join(channels, channel)).catch(() => [])) {
      if (!name.endsWith('.json')) continue;
      const { mtime } = await stat(join(channels, channel, name));
      rows.push([channel, name.slice(0, -5), mtime.toISOString().slice(0, 16).replace('T', ' ')]);
    }
  }
  return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

const readable = () =>
  stat(root).then(
    (s) => s.isDirectory(),
    () => false,
  );

adminFromEnv('updates', servicePort, {
  health: async () => {
    const ok = await readable();
    return [{ name: 'Folder', ok, detail: ok ? root : `${root} is missing` }];
  },
  status: async () => {
    const rows = (await readable()) ? await published() : [];
    return {
      checks: [],
      tables: [
        {
          title: 'Published updates',
          note: rows.length ? undefined : 'None yet: scripts/ota.mts writes them into this folder.',
          columns: ['Channel', 'Runtime version', 'Published'],
          rows,
        },
      ],
    };
  },
});
