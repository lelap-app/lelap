// The demo library: made-up books for reference shots of the app, served by a tiny add-on with
// drawn covers and silent audio. Nothing here comes from a real library or real files.

// Cover colours, the same as the landing page's `--cover-*` tokens, and its amber.
const C = {
  navy: '#22324f',
  teal: '#1f4746',
  plum: '#3f2a48',
  forest: '#2a4231',
  wine: '#57262c',
  slate: '#39404d',
  ocean: '#1e3a57',
  olive: '#48472a',
  rose: '#6a3a48',
  sand: '#d8cab0',
  paper: '#ebe3d3',
  broth: '#b5573a',
  ink: '#ede6d6',
  inkDark: '#1d1a16',
};
const amber = '#f5b041';

// Small drawn scenes on a 60×60 canvas.
const birds = [
  [12, 14],
  [19, 10],
  [16, 21],
  [25, 17],
  [9, 26],
  [22, 27],
]
  .map(([x, y]) => `<path d="M${x - 3} ${y}q1.5-2 3 0q1.5-2 3 0" stroke="${C.inkDark}"/>`)
  .join('');

const weeks = Array.from({ length: 81 }, (_, i) => {
  const x = 8 + (i % 9) * 5.5;
  const y = 8 + Math.floor(i / 9) * 5.5;
  const lived = i < 34;
  return `<circle cx="${x}" cy="${y}" r="1.6" fill="${lived ? amber : C.paper}" opacity="${lived ? 1 : 0.3}"/>`;
}).join('');

const habits = [1, 1, 2, 3, 5, 8]
  .flatMap((count, col) =>
    Array.from({ length: count }, (_, k) => {
      const top = col === 5 && k === count - 1;
      return `<rect x="${12 + col * 6.4}" y="${50 - (k + 1) * 5.2}" width="4.2" height="4.2" rx="0.6" fill="${top ? amber : C.navy}"/>`;
    }),
  )
  .join('');

const wreath = Array.from({ length: 9 }, (_, i) => {
  const a = ((110 + i * 17) * Math.PI) / 180;
  const x = 30 + 17 * Math.cos(a);
  const y = 30 + 17 * Math.sin(a);
  const r = (110 + i * 17 + 90) % 360;
  return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.4" ry="1.5" transform="rotate(${r} ${x.toFixed(1)} ${y.toFixed(1)})"/><ellipse cx="${(60 - x).toFixed(1)}" cy="${y.toFixed(1)}" rx="3.4" ry="1.5" transform="rotate(${-r} ${(60 - x).toFixed(1)} ${y.toFixed(1)})"/>`;
}).join('');

const bats = [
  [14, 14, 1],
  [24, 9, 0.8],
  [44, 22, 0.9],
  [35, 15, 0.7],
]
  .map(
    ([x, y, k]) =>
      `<path transform="translate(${x} ${y}) scale(${k})" d="M0 0q-3-3-7-1 2 0 2 2-2 0-3 2 3-1 5 0 1-2 3-1 2-1 3 1 2-1 5 0-1-2-3-2 0-2 2-2-4-2-7 1z"/>`,
  )
  .join('');

const garland = Array.from({ length: 7 }, (_, i) => {
  const x = 6 + i * 8;
  const y = 12 + Math.sin((i / 6) * Math.PI) * 9;
  return `<circle cx="${x}" cy="${y.toFixed(1)}" r="3" fill="${i % 2 ? C.broth : amber}"/>`;
}).join('');

const scene = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="600" height="600">${body}</svg>`;

const art = {
  atomic: scene(`<rect width="60" height="60" fill="${C.paper}"/>${habits}
    <path d="M10 51h40" stroke="${C.navy}" stroke-width="1"/>`),
  weeks: scene(`<rect width="60" height="60" fill="${C.ocean}"/>${weeks}`),
  courage: scene(`<rect width="60" height="60" fill="${C.wine}"/>
    <g fill="none" stroke-width="1.4" stroke-linecap="round">${birds}
    <path d="M38 22q2.5-3.5 5 0q2.5-3.5 5 0" stroke="${amber}" stroke-width="2"/></g>
    <path d="M0 46h60v14H0z" fill="${C.plum}"/>
    <path d="M30 46v-9" stroke="${C.inkDark}" stroke-width="1.4"/>
    <circle cx="30" cy="35" r="1.6" fill="${C.inkDark}"/>`),
  meditations: scene(`<rect width="60" height="60" fill="${C.slate}"/>
    <g fill="${C.sand}">${wreath}</g>
    <circle cx="30" cy="30" r="5" fill="${amber}"/>`),
  apple: scene(`<rect width="60" height="60" fill="${C.inkDark}"/>
    <path d="M30 22c-8-5-18 0-17 11 1 10 8 17 13 16 2 0 3-1 4-1s2 1 4 1c5 1 12-6 13-16 1-11-9-16-17-11z" fill="${C.wine}"/>
    <path d="M30 22c0-4 2-7 5-8" stroke="${C.olive}" stroke-width="1.6" fill="none"/>
    <path d="M42 6L24 40l2 1L44 7z" fill="${C.paper}"/><path d="M24 40l-3 6 4-4z" fill="${C.inkDark}"/>
    <path d="M27 36c0 4-1 8-1 12M28.5 37c.5 3 .5 6 0 8" stroke="${C.broth}" stroke-width="1.2" fill="none"/>`),
  wound: scene(`<rect width="60" height="60" fill="${C.forest}"/>
    <circle cx="30" cy="18" r="9" fill="${C.sand}" opacity="0.9"/>
    <path d="M0 60V36c6-4 10-2 14-6 2 6 6 6 8 2 3 5 8 5 11 0 3 4 7 4 9-1 4 4 8 3 12 1 3 2 4 3 6 4v24z" fill="${C.inkDark}"/>
    <path d="M26 52c0-8 2-14 4-16 2 2 4 8 4 16z" fill="${C.paper}" opacity="0.85"/>
    <circle cx="30" cy="34" r="2.4" fill="${C.paper}" opacity="0.85"/>
    <path d="M44 42h2v10h-2zM46 44l4-2" stroke="${C.rose}" stroke-width="1" fill="${C.rose}"/>`),
  gothic: scene(`<rect width="60" height="60" fill="${C.plum}"/>
    <path d="M14 52V24l16-12 16 12v28z" fill="${C.inkDark}"/>
    <path d="M22 30h4v6h-4zM34 30h4v6h-4z" fill="${amber}" opacity="0.85"/><path d="M27 52V42a3 3 0 0 1 6 0v10z" fill="${C.slate}"/>
    <g fill="${C.sand}" opacity="0.8"><circle cx="8" cy="50" r="3"/><circle cx="11" cy="46" r="2"/><circle cx="50" cy="48" r="3"/><circle cx="53" cy="52" r="2.2"/><circle cx="47" cy="53" r="1.8"/></g>
    <path d="M0 54h60v6H0z" fill="${C.forest}"/>`),
  strange: scene(`<rect width="60" height="60" fill="${C.paper}"/>
    <g fill="none" stroke="${C.navy}" stroke-width="1.6" stroke-linecap="square">
      <rect x="9" y="11" width="42" height="38"/>
      <path d="M9 29h12M25 29h2M27 11v12M27 27v22M40 34h11M27 34h7M37 11v23M40 34v15"/>
    </g>
    <path d="M37 22h3v12h-3z" fill="${C.rose}"/>`),
  batEater: scene(`<rect width="60" height="60" fill="${C.inkDark}"/>
    <circle cx="44" cy="13" r="7" fill="${C.sand}" opacity="0.85"/>
    <g fill="${C.plum}">${bats}</g>
    <path d="M0 60V38h8v-6h6v10h6V30h8v12h5v-8h9v10h6v-6h8v6h4v16z" fill="${C.plum}"/>
    <path d="M23 34h2v3h-2zM38 38h2v3h-2zM10 36h2v3h-2z" fill="${amber}" opacity="0.8"/>
    <rect x="28" y="44" width="4" height="6" rx="2" fill="${C.broth}"/>
    <path d="M30 42v2" stroke="${C.broth}" stroke-width="0.8"/>`),
  inherit: scene(`<rect width="60" height="60" fill="${C.sand}"/>
    <path d="M0 4q30 18 60 0" stroke="${C.olive}" stroke-width="1" fill="none"/>${garland}
    <path d="M18 60V40a12 12 0 0 1 24 0v20z" fill="${C.wine}"/>
    <path d="M22 60V41a8 8 0 0 1 16 0v19z" fill="${C.inkDark}" opacity="0.55"/>
    <path d="M27 54c0-3 6-3 6 0z" fill="${amber}"/><path d="M30 51c-1 1-1 2 0 3 1-1 1-2 0-3z" fill="${C.broth}"/>`),
  flies: scene(`<rect width="60" height="60" fill="${C.ocean}"/>
    <circle cx="14" cy="13" r="6" fill="${amber}" opacity="0.9"/>
    <path d="M4 40c6-9 16-12 26-12s20 3 26 12z" fill="${C.forest}"/>
    <path d="M36 30c1-6 4-9 8-10M44 20c-3 0-6 1-8 3M44 20c-1 3-1 5 0 7" stroke="${C.olive}" stroke-width="1.6" fill="none"/>
    <path d="M0 40h60v20H0z" fill="${C.sand}" opacity="0.9"/>
    <path d="M18 50c0-5 6-8 13-6 4 1 6 4 4 6z" fill="${C.paper}"/>
    <path d="M21 49c2-3 6-4 10-3M24 50c2-2 5-2 8-1" stroke="${C.rose}" stroke-width="0.9" fill="none"/>
    <path d="M45 42c-2 3 1 4 0 6 2-1 3-3 1-6zM42 47h7" stroke="${C.broth}" stroke-width="1.2" fill="${amber}"/>`),
};

// The made-up book of the hero, as a whole HTML page because its cover carries type: the browser
// that takes the screenshots renders it with the site's own fonts.
const laksaCover = (title) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Space Grotesk'; src: url('/fonts/space-grotesk.woff2') format('woff2'); font-weight: 300 700; }
@font-face { font-family: 'Inter'; src: url('/fonts/inter.woff2') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: 600px; height: 600px; overflow: hidden; }
.cover { position: relative; box-sizing: border-box; width: 600px; height: 600px; padding: 48px;
  background: linear-gradient(170deg, ${C.teal} 55%, ${C.ocean}); display: flex; flex-direction: column; gap: 26px; }
.author { font: 500 26px/1 Inter, sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: ${C.sand}; }
.title { max-width: 400px; font: 600 62px/1.02 'Space Grotesk', sans-serif; color: ${C.ink}; }
svg { position: absolute; right: 26px; bottom: 26px; width: 306px; }
</style></head><body><div class="cover"><span class="author">Janet Tay</span><span class="title">${title}</span>
<svg viewBox="0 0 120 96" fill="none" stroke-linecap="round">
<circle cx="94" cy="20" r="11" fill="${C.sand}" opacity="0.35"/>
<path d="M44 30c-5-6 5-10 0-16M60 28c-5-6 5-10 0-16M76 30c-5-6 5-10 0-16" stroke="${C.ink}" stroke-width="2.4" opacity="0.7"/>
<path d="M78 6 52 46M90 10 60 47" stroke="${C.sand}" stroke-width="3"/>
<path d="M14 48h92a46 40 0 0 1-92 0z" fill="${C.paper}"/>
<path d="M18 48h84" stroke="${C.broth}" stroke-width="7"/>
<path d="M44 92h32" stroke="${C.paper}" stroke-width="5"/>
</svg></div></body></html>`;

const min = (m, s = 0) => (m * 60 + s) * 1000;

// Lines that change with the language. The Malay ones are the landing page's own lines for the
// same book and rows, so a Malay screenshot matches the Malay page.
const TEXT = {
  en: {
    laksa: 'Early Mornings at the Laksa Café',
    about:
      'A made-up novel: a café owner in Penang, the regulars who come before sunrise, and the recipe her mother never wrote down.',
    selfImprovement: 'Self-improvement',
    growingUp: 'Growing up',
    horror: 'Horror and uncanny',
    chapter: 'Chapter {n}',
  },
  ms: {
    laksa: 'Pagi-pagi di Kafe Laksa',
    about:
      'Novel rekaan: pemilik kafe di Pulau Pinang, pelanggan tetap yang datang sebelum matahari terbit, dan resipi yang tidak pernah ditulis oleh ibunya.',
    selfImprovement: 'Pembangunan diri',
    growingUp: 'Membesar',
    horror: 'Seram dan ganjil',
    chapter: 'Bab {n}',
  },
};

export const LANGUAGES = Object.keys(TEXT);

/** The made-up library in one language: the hero book and three catalog rows. */
export function demoLibrary(lang) {
  const text = TEXT[lang] ?? TEXT.en;
  const chapter = (n) => text.chapter.replace('{n}', String(n));
  const book = (id, name, author, cover, durationMs, chapters) => ({
    id: `demo:${id}`,
    name,
    author,
    cover,
    durationMs,
    chapters: Array.from({ length: chapters }, (_, i) => ({
      title: chapter(i + 1),
      durationMs: Math.round(durationMs / chapters),
    })),
  });
  // Chapter 3 is 20:35 long, so 12:04 into it leaves 8:31, as on the old drawing.
  const laksaChapters = [
    min(18, 12),
    min(23, 40),
    min(20, 35),
    min(21, 8),
    min(19, 51),
    min(24, 3),
  ];
  const laksa = {
    id: 'demo:laksa',
    name: text.laksa,
    author: 'Janet Tay',
    cover: 'laksa',
    description: text.about,
    durationMs: laksaChapters.reduce((sum, ms) => sum + ms, 0),
    chapters: laksaChapters.map((durationMs, i) => ({ title: chapter(i + 1), durationMs })),
  };
  // Real titles with our own drawings, never the publishers' covers, as on the old mock-up.
  return {
    laksa,
    rows: [
      {
        id: 'self-improvement',
        name: text.selfImprovement,
        books: [
          book('atomic', 'Atomic Habits', 'James Clear', 'atomic', min(335), 20),
          book('weeks', 'Four Thousand Weeks', 'Oliver Burkeman', 'weeks', min(605), 16),
          book('courage', 'The Courage to Be Disliked', 'Ichiro Kishimi', 'courage', min(398), 5),
          book('meditations', 'Meditations', 'Marcus Aurelius', 'meditations', min(310), 12),
        ],
      },
      {
        id: 'growing-up',
        name: text.growingUp,
        books: [
          book(
            'bat-eater',
            'Bat Eater and Other Names for Cora Zeng',
            'Kylie Lee Baker',
            'batEater',
            min(560),
            30,
          ),
          book(
            'inherit',
            'What We Inherit: Growing Up Indian',
            'Various authors',
            'inherit',
            min(480),
            12,
          ),
          book('flies', 'Lord of the Flies', 'William Golding', 'flies', min(388), 12),
        ],
      },
      {
        id: 'horror',
        name: text.horror,
        books: [
          book('strange', 'Strange Houses', 'Uketsu', 'strange', min(250), 3),
          book('apple', 'Apple and Knife', 'Intan Paramaditha', 'apple', min(330), 18),
          book('gothic', 'Mexican Gothic', 'Silvia Moreno-Garcia', 'gothic', min(660), 27),
          book('wound', 'Beauty Is a Wound', 'Eka Kurniawan', 'wound', min(1130), 18),
        ],
      },
    ],
  };
}

export const COVER_KEYS = ['laksa', ...Object.keys(art)];

/** One cover: an SVG for the drawn scenes, an HTML page for the hero book, whose cover has type. */
export function coverSource(key, title) {
  if (key === 'laksa') return { html: laksaCover(title) };
  return { svg: art[key] };
}
