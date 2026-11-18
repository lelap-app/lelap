// The books the catalog serves: two public-domain LibriVox recordings on archive.org. Replace them
// with your own source, and only serve audio you are allowed to share.
const archive = (item, file) => `https://archive.org/download/${item}/${file}`;
const carol = (part) => archive('A_Christmas_Carol', `A_Christmas_Carol_${part}_Dickens_64kb.mp3`);

export const BOOKS = [
  {
    meta: {
      id: 'classics:raven',
      type: 'audiobook',
      name: 'The Raven',
      author: 'Edgar Allan Poe',
      cover: 'https://archive.org/services/img/raven',
      year: 1845,
      durationMs: 570_000,
      description: 'A grieving narrator is visited at midnight by a talking raven.',
    },
    stream: { url: archive('raven', 'raven_poe_64kb.mp3'), durationMs: 570_000 },
  },
  {
    meta: {
      id: 'classics:christmas-carol',
      type: 'audiobook',
      name: 'A Christmas Carol',
      author: 'Charles Dickens',
      cover: 'https://archive.org/services/img/A_Christmas_Carol',
      year: 1843,
      durationMs: 11_669_000,
      description: 'Ebenezer Scrooge is visited by three spirits on Christmas Eve.',
    },
    stream: {
      parts: [
        { title: 'Preface and Stave 1', url: carol('Preface_and_Stave_1'), durationMs: 2_680_000 },
        { title: 'Stave 2', url: carol('Stave_2'), durationMs: 2_660_000 },
        { title: 'Stave 3', url: carol('Stave_3'), durationMs: 2_674_000 },
        { title: 'Stave 4', url: carol('Stave_4'), durationMs: 2_529_000 },
        { title: 'Stave 5', url: carol('Stave_5'), durationMs: 1_126_000 },
      ],
    },
  },
];
