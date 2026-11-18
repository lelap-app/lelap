// A source add-on: audio for works that other add-ons' pages show. Lelap asks it for streams by
// the work's ID (`ol:…` from the Catalog add-on, or `isbn:…` and `asin:…` from `externalIds`),
// and the SDK's matcher finds which of its files that work is.
import { createAddon, createWorkIndex, idsFromTags, lookupWork, splitAuthors } from '@lelap/sdk';

export const manifest = {
  // Use a reverse-DNS ID of a domain you control.
  id: 'org.example.source',
  version: '1.0.0',
  protocol: 1,
  name: 'Source example',
  description: 'Two public-domain recordings, found by the work on any book page.',
  types: ['audiobook'],
  resources: [{ name: 'stream', types: ['audiobook'], idPrefixes: ['ol:', 'isbn:', 'asin:'] }],
  idPrefixes: ['ol:', 'isbn:', 'asin:'],
  catalogs: [],
};

// Your file list, with the tags your files carry. Replace it with a scan of your own storage, and
// only serve audio you are allowed to share.
const archive = (item, file) => `https://archive.org/download/${item}/${file}`;
const carol = (part) => archive('A_Christmas_Carol', `A_Christmas_Carol_${part}_Dickens_64kb.mp3`);

export const FILES = [
  {
    // A made-up ISBN where your tagger would write the edition's real one.
    tags: { album: 'The Raven', artist: 'Edgar Allan Poe', ISBN: '978-0-00-000000-2' },
    parts: [['The Raven', archive('raven', 'raven_poe_64kb.mp3'), 570_000]],
  },
  {
    // No ID in the tags: found by title and author.
    tags: { album: 'A Christmas Carol (Unabridged)', artist: 'Dickens, Charles' },
    parts: [
      ['Preface and Stave 1', carol('Preface_and_Stave_1'), 2_680_000],
      ['Stave 2', carol('Stave_2'), 2_660_000],
      ['Stave 3', carol('Stave_3'), 2_674_000],
      ['Stave 4', carol('Stave_4'), 2_529_000],
      ['Stave 5', carol('Stave_5'), 1_126_000],
    ],
  },
];

const DAY = 86_400;

const streamOf = (file, index) => ({
  sourceKey: `example-source:${index}`,
  name: manifest.name,
  title: file.tags.album,
  mime: 'audio/mpeg',
  downloadable: true,
  parts: file.parts.map(([title, url, durationMs]) => ({ title, url, durationMs })),
});

/** The add-on; `options` reach `lookupWork`, so tests can answer for Open Library. */
export function createSourceAddon(options = {}) {
  // Built once from the file list: IDs from the tags, titles and authors from the rest.
  const index = createWorkIndex(
    FILES.map((file, i) => ({
      item: i,
      title: file.tags.album,
      authors: splitAuthors(file.tags.artist),
      ids: idsFromTags(file.tags),
    })),
  );

  return createAddon({
    manifest,
    async stream({ id }) {
      // `isbn:` and `asin:` need no request; an `ol:` work is looked up at Open Library.
      const work = await lookupWork(id, options);
      const matches = work ? index.find(work) : [];
      return {
        streams: matches.map(({ item }) => streamOf(FILES[item], item)),
        cacheMaxAge: matches.length > 0 ? DAY : 3600,
      };
    },
  });
}
