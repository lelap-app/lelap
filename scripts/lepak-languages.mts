// Measures what Podcast Index answers by language for Lepak (M131). First each row as the add-on
// asks it (its `lang` and `cat`), with how many feeds come back and how many the add-on keeps;
// then each language code alone, with the `language` values those feeds say. Run by hand with
// Node's type stripping and the catalog service's keys in the environment; it prints counts only,
// never the keys:
//   PODCASTINDEX_KEY=… PODCASTINDEX_SECRET=… node scripts/lepak-languages.mts
import { createHash } from 'node:crypto';

const API = 'https://api.podcastindex.org/api/1.0';
const ENDPOINTS = ['podcasts/trending', 'recent/feeds'];
const MAX = 1000;
// Copied from services/catalog/src/lepak/addon.ts; keep them the same.
const MALAY_INDONESIAN = 'ms,ms-my,ms-sg,ms-bn,id,id-id,in,in-id';
const SINGAPORE = 'en-sg,zh-sg,ms-sg,ta-sg';
const malay = (l: string) =>
  ['ms', 'id', 'in'].includes(l.trim().toLowerCase().split(/[-_]/)[0] ?? '');
const singapore = (l: string) => /[-_]sg$/i.test(l.trim());
const ROWS = [
  { name: 'Cerita', lang: MALAY_INDONESIAN, cat: 'Fiction,Drama,Stories', keep: malay },
  { name: 'Sembang', lang: MALAY_INDONESIAN, cat: 'Society,Culture,Comedy,Leisure', keep: malay },
  { name: 'Sejarah', lang: MALAY_INDONESIAN, cat: 'History', keep: malay },
  { name: 'Singapura', lang: SINGAPORE, cat: '', keep: singapore },
];
const CODES = ['ms', 'id', 'ms-my', 'id-id', 'en-sg', 'zh-sg', 'ms-sg', 'ta-sg'];

const key = process.env.PODCASTINDEX_KEY?.trim();
const secret = process.env.PODCASTINDEX_SECRET?.trim();
if (!key || !secret) {
  console.error('Set PODCASTINDEX_KEY and PODCASTINDEX_SECRET.');
  process.exit(1);
}
const credentials = { key, secret };
const agent = process.env.SOURCE_URL ? `Lelap/1 (+${process.env.SOURCE_URL})` : 'Lelap/1';

async function feeds(
  endpoint: string,
  lang: string,
  cat: string,
): Promise<{ language?: string }[]> {
  const date = String(Math.floor(Date.now() / 1000));
  const params = new URLSearchParams({ lang, max: String(MAX) });
  if (cat) params.set('cat', cat);
  const response = await fetch(`${API}/${endpoint}?${params}`, {
    headers: {
      'User-Agent': agent,
      'X-Auth-Key': credentials.key,
      'X-Auth-Date': date,
      Authorization: createHash('sha1')
        .update(credentials.key + credentials.secret + date)
        .digest('hex'),
    },
  });
  if (!response.ok) throw new Error(`Podcast Index answered ${response.status} for ${endpoint}`);
  const data = (await response.json()) as { feeds?: { language?: string }[] };
  return data.feeds ?? [];
}

const said = (found: { language?: string }[]) => {
  const counts = new Map<string, number>();
  for (const feed of found) {
    const language = feed.language ?? '(none)';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${l} ${n}`)
    .join(', ');
};

console.log('Rows, as the add-on asks:');
for (const endpoint of ENDPOINTS) {
  for (const row of ROWS) {
    const found = await feeds(endpoint, row.lang, row.cat);
    const kept = found.filter((f) => f.language !== undefined && row.keep(f.language));
    console.log(
      `${endpoint} ${row.name}: ${found.length} feeds, ${kept.length} kept; ${said(found)}`,
    );
  }
}
console.log('\nEach code alone:');
for (const endpoint of ENDPOINTS) {
  for (const lang of CODES) {
    const found = await feeds(endpoint, lang, '');
    console.log(`${endpoint} lang=${lang}: ${found.length} feeds; ${said(found)}`);
  }
}
