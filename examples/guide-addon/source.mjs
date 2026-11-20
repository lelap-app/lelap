// Step 3: a source. Book pages from other add-ons ask for streams by the work's ID, and the SDK's
// matcher finds which of your own files that work is.
import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { createAddon, createWorkIndex, log, lookupWork, splitAuthors } from '@lelap/sdk';

import { handlers as settingsHandlers } from './settings.mjs';

const AUDIO = new Set(['.m4b', '.m4a', '.mp3', '.ogg', '.opus']);
const MIME = { '.m4b': 'audio/mp4', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg' };

/** Your books as `<folder>/<Author>/<Title>.m4b`: one file per book. */
export async function scanFolder(folder) {
  const files = [];
  for (const author of await readdir(folder, { withFileTypes: true })) {
    if (!author.isDirectory()) continue;
    for (const file of await readdir(join(folder, author.name))) {
      const ext = extname(file).toLowerCase();
      if (!AUDIO.has(ext)) continue;
      files.push({
        author: author.name,
        title: file.slice(0, -ext.length),
        path: [author.name, file],
        ext,
      });
    }
  }
  return files;
}

/**
 * `folder` is where the files are on disk; `filesUrl` is where your web server or WebDAV server
 * serves that folder. Other options reach `lookupWork`, so tests can answer for Open Library.
 */
export async function createSourceAddon({ folder, filesUrl, ...lookupOptions }) {
  const files = await scanFolder(folder);
  // Built once: titles and authors from the folder. Tags with an ISBN would go into `ids`.
  const index = createWorkIndex(
    files.map((file, item) => ({ item, title: file.title, authors: splitAuthors(file.author) })),
  );
  const base = filesUrl.replace(/\/$/, '');

  const manifest = {
    ...settingsHandlers.manifest,
    resources: [
      'catalog',
      'meta',
      // Streams for its own catalog, and for works by their Open Library ID or ISBN.
      { name: 'stream', types: ['audiobook'], idPrefixes: ['classics:', 'ol:', 'isbn:'] },
    ],
  };

  return createAddon({
    ...settingsHandlers,
    manifest,
    async stream(args) {
      if (args.id.startsWith('classics:')) return settingsHandlers.stream(args);
      // An `isbn:` needs no request; an `ol:` work's title and authors come from Open Library.
      const work = await lookupWork(args.id, lookupOptions);
      const matches = work ? index.find(work) : [];
      // One JSON line per lookup. `log` takes only strings, numbers and booleans, so an error or
      // a URL with a key in it can't slip into your logs.
      log('stream.lookup', { id: args.id, found: matches.length });
      return {
        streams: matches.map(({ item }) => {
          const file = files[item];
          return {
            sourceKey: `my-files:${file.path.join('/')}`,
            name: 'My files',
            title: file.title,
            url: `${base}/${file.path.map(encodeURIComponent).join('/')}`,
            ...(MIME[file.ext] ? { mime: MIME[file.ext] } : {}),
            downloadable: true,
          };
        }),
        // Short when nothing matched: the app asks again soon after you add the book and restart.
        cacheMaxAge: matches.length > 0 ? 86_400 : 600,
      };
    },
  });
}
