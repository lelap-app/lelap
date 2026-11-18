// Step 1: a catalog add-on. One catalog of books, their details and where to play them.
import { createAddon } from '@lelap/sdk';

import { BOOKS } from './books.mjs';

export const manifest = {
  // A reverse-DNS ID of a domain you control. Keep it when you release new versions.
  id: 'org.example.classics',
  version: '1.0.0',
  protocol: 1,
  name: 'Classics',
  description: 'Public-domain books read by LibriVox volunteers.',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  // The app asks this add-on for meta and streams of IDs that start with this.
  idPrefixes: ['classics:'],
  catalogs: [{ type: 'audiobook', id: 'classics', name: 'Classics' }],
};

const DAY = 86_400;
const byId = (id) => BOOKS.find((book) => book.meta.id === id);

// A catalog row needs less than the details page: no description.
export const preview = ({ id, type, name, author, cover, year, durationMs }) => ({
  id,
  type,
  name,
  author,
  cover,
  year,
  durationMs,
});

export const handlers = {
  manifest,
  catalog: () => ({ metas: BOOKS.map((book) => preview(book.meta)), cacheMaxAge: DAY }),
  meta: ({ id }) => {
    const book = byId(id);
    return book ? { meta: book.meta, cacheMaxAge: DAY } : null;
  },
  stream: ({ id }) => {
    const book = byId(id);
    if (!book) return { streams: [] };
    return {
      streams: [
        {
          // Stable across versions: the app keeps the listener's place under it.
          sourceKey: `${id}:librivox`,
          name: manifest.name,
          title: 'LibriVox recording',
          mime: 'audio/mpeg',
          downloadable: true,
          ...book.stream,
        },
      ],
      cacheMaxAge: DAY,
    };
  },
};

export const addon = createAddon(handlers);
