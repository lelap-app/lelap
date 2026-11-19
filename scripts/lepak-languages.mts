// Measures what Podcast Index answers by language for Lepak (M131): how many feeds
// `podcasts/trending` and `recent/feeds` return per `lang` code, and which `language` values those
// feeds say. Run by hand with Node's type stripping and the catalog service's keys in the
// environment; it prints counts only, never the keys:
//   PODCASTINDEX_KEY=… PODCASTINDEX_SECRET=… node scripts/lepak-languages.mts
import { createHash } from 'node:crypto';

const API = 'https://api.podcastindex.org/api/1.0';
const CODES = ['ms', 'id', 'ms-my', 'id-id', 'en-sg', 'zh-sg', 'ms-sg', 'ta-sg'];
const ENDPOINTS = ['podcasts/trending', 'recent/feeds'];
const MAX = 1000;

const key = process.env.PODCASTINDEX_KEY?.trim();
const secret = process.env.PODCASTINDEX_SECRET?.trim();
if (!key || !secret) {
  console.error('Set PODCASTINDEX_KEY and PODCASTINDEX_SECRET.');
  process.exit(1);
}
const credentials = { key, secret };

async function feeds(endpoint: string, lang: string): Promise<{ language?: string }[]> {
  const date = String(Math.floor(Date.now() / 1000));
  const response = await fetch(
    `${API}/${endpoint}?${new URLSearchParams({ lang, max: String(MAX) })}`,
    {
      headers: {
        'User-Agent': 'Lelap/1 (+https://github.com/lelap-app/lelap)',
        'X-Auth-Key': credentials.key,
        'X-Auth-Date': date,
        Authorization: createHash('sha1')
          .update(credentials.key + credentials.secret + date)
          .digest('hex'),
      },
    },
  );
  if (!response.ok) throw new Error(`Podcast Index answered ${response.status} for ${endpoint}`);
  const data = (await response.json()) as { feeds?: { language?: string }[] };
  return data.feeds ?? [];
}

for (const endpoint of ENDPOINTS) {
  for (const lang of CODES) {
    const found = await feeds(endpoint, lang);
    const said = new Map<string, number>();
    for (const feed of found) {
      const language = feed.language ?? '(none)';
      said.set(language, (said.get(language) ?? 0) + 1);
    }
    const languages = [...said].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`);
    console.log(`${endpoint} lang=${lang}: ${found.length} feeds; ${languages.join(', ')}`);
  }
}
