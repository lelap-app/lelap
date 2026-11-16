import type { Meta, Stream } from '@lelap/sdk';

// Two public-domain LibriVox recordings, served by archive.org. Replace these with your own source.
const download = (item: string, file: string) => `https://archive.org/download/${item}/${file}`;

export const BOOKS: { meta: Meta; stream: Stream }[] = [
  {
    meta: {
      id: 'template:raven',
      type: 'audiobook',
      name: 'The Raven',
      author: 'Edgar Allan Poe',
      cover: 'https://archive.org/services/img/raven',
      year: 1845,
      durationMs: 570_000,
      description: 'A grieving narrator is visited at midnight by a talking raven.',
    },
    stream: {
      sourceKey: 'template:raven:64kb',
      name: 'Template',
      title: 'LibriVox recording',
      url: download('raven', 'raven_poe_64kb.mp3'),
      durationMs: 570_000,
      mime: 'audio/mpeg',
      downloadable: true,
    },
  },
  {
    meta: {
      id: 'template:christmas-carol',
      type: 'audiobook',
      name: 'A Christmas Carol',
      author: 'Charles Dickens',
      cover: 'https://archive.org/services/img/A_Christmas_Carol',
      year: 1843,
      durationMs: 11_669_000,
      description: 'Ebenezer Scrooge is visited by three spirits on Christmas Eve.',
    },
    stream: {
      sourceKey: 'template:christmas-carol:64kb',
      name: 'Template',
      title: 'LibriVox recording',
      mime: 'audio/mpeg',
      downloadable: true,
      parts: [
        [
          'Preface and Stave 1',
          'A_Christmas_Carol_Preface_and_Stave_1_Dickens_64kb.mp3',
          2_680_000,
        ],
        ['Stave 2', 'A_Christmas_Carol_Stave_2_Dickens_64kb.mp3', 2_660_000],
        ['Stave 3', 'A_Christmas_Carol_Stave_3_Dickens_64kb.mp3', 2_674_000],
        ['Stave 4', 'A_Christmas_Carol_Stave_4_Dickens_64kb.mp3', 2_529_000],
        ['Stave 5', 'A_Christmas_Carol_Stave_5_Dickens_64kb.mp3', 1_126_000],
      ].map(([title, file, durationMs]) => ({
        title: String(title),
        url: download('A_Christmas_Carol', String(file)),
        durationMs: Number(durationMs),
      })),
    },
  },
];
