// Builds the Open lectures list (M132), services/catalog/src/lectures/courses.ts, from Open Yale
// Courses' pages and archive.org's `openyalecourses` copies. Run once by hand with Node's type
// stripping, then read the result by hand before committing it:
//   node scripts/open-lectures.mts [cache folder]
// Pages and answers are kept in the cache folder (default: a temporary one), so a second run asks
// nobody. It prints, per course, which host streams it and why a course is left out.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as prettier from 'prettier';

const YALE = 'https://oyc.yale.edu';
const ARCHIVE = 'https://archive.org';
const OUT = 'services/catalog/src/lectures/courses.ts';
const AGENT = 'Lelap/1 (+https://github.com/lelap-app/lelap)';
const cache = process.argv[2] ?? join(tmpdir(), 'lelap-open-lectures');
mkdirSync(cache, { recursive: true });

type Lecture = { title: string; page: string; audio: string; durationMs: number };
type Course = {
  id: string;
  code: string;
  title: string;
  lecturer: string;
  term: string;
  department: string;
  page: string;
  description: string;
  archive: string | null;
  host: 'yale' | 'archive';
  lectures: Lecture[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url: string, kind: 'text' | 'head'): Promise<string> {
  const file = join(cache, `${kind}-${url.replace(/[^a-z0-9]+/gi, '_').slice(-180)}`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: kind === 'head' ? 'HEAD' : 'GET',
        headers: { 'User-Agent': AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
      // A busy server is asked again later, not remembered as a missing file.
      if (response.status >= 500 && attempt < 2) throw new Error(`${response.status} for ${url}`);
      const body =
        kind === 'head'
          ? JSON.stringify({
              status: response.status,
              type: response.headers.get('content-type'),
              length: Number(response.headers.get('content-length') ?? NaN),
            })
          : response.ok
            ? await response.text()
            : '';
      writeFileSync(file, body);
      return body;
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(2000);
    }
  }
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index] as T);
      }
    }),
  );
  return results;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&rsquo;|&#8217;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Straight quotes to curly ones, as Lelap writes prose. */
const curly = (s: string) => s.replace(/"([^"]*)"/g, '“$1”').replace(/'/g, '’');

const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function parseLength(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 1000);
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(text))
    return Math.round(text.split(':').reduce((t, p) => t * 60 + parseFloat(p), 0) * 1000);
  return null;
}

type ArchiveFile = { name: string; length: number | null; size: number };

async function archiveItems(): Promise<Map<string, string>> {
  const url = `${ARCHIVE}/advancedsearch.php?q=collection%3Aopenyalecourses&fl%5B%5D=identifier&fl%5B%5D=mediatype&fl%5B%5D=title&rows=100&output=json`;
  const data = JSON.parse(await get(url, 'text')) as {
    response: { docs: { identifier: string; mediatype: string; title: string }[] };
  };
  const byTitle = new Map<string, string>();
  for (const doc of data.response.docs) {
    // The video items are never used.
    if (doc.mediatype !== 'audio') continue;
    byTitle.set(normal(doc.title.replace(/^Open Yale Courses?:\s*/, '')), doc.identifier);
  }
  return byTitle;
}

async function archiveFiles(identifier: string): Promise<ArchiveFile[]> {
  const data = JSON.parse(await get(`${ARCHIVE}/metadata/${identifier}`, 'text')) as {
    files?: { name: string; length?: string; size?: string; source?: string }[];
  };
  return (data.files ?? [])
    .filter((f) => f.source === 'original' && f.name.toLowerCase().endsWith('.mp3'))
    .map((f) => ({ name: f.name, length: parseLength(f.length), size: Number(f.size ?? NaN) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/** The MP3's length from its first frame header: constant bit rate, as Yale encoded them. */
async function lengthFromHeader(url: string, size: number): Promise<number | null> {
  const file = join(cache, `frame-${url.replace(/[^a-z0-9]+/gi, '_').slice(-180)}`);
  let bytes: Buffer;
  if (existsSync(file)) bytes = readFileSync(file);
  else {
    const response = await fetch(url, {
      headers: { 'User-Agent': AGENT, Range: 'bytes=0-65535' },
      signal: AbortSignal.timeout(30_000),
    });
    bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(file, bytes);
  }
  let offset = 0;
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') {
    const b = (i: number) => bytes[6 + i] ?? 0;
    offset = 10 + ((b(0) << 21) | (b(1) << 14) | (b(2) << 7) | b(3));
  }
  for (let i = offset; i < bytes.length - 4; i++) {
    if (bytes[i] !== 0xff || ((bytes[i + 1] ?? 0) & 0xe0) !== 0xe0) continue;
    const version = ((bytes[i + 1] ?? 0) >> 3) & 3; // 3 = MPEG 1, 2 = MPEG 2
    const index = (bytes[i + 2] ?? 0) >> 4;
    const v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const kbps = (version === 3 ? v1 : v2)[index];
    if (!kbps) continue;
    // A Xing or Info header means variable bit rate; the frame rate alone would be wrong.
    const head = bytes.subarray(i, i + 200).toString('latin1');
    if (head.includes('Xing') || head.includes('VBRI')) return null;
    return Math.round(((size - i) * 8) / kbps);
  }
  return null;
}

async function main() {
  const listing = await get(`${YALE}/courses`, 'text');
  const rows = [...listing.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap((m) => {
    const cells = [...(m[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1] ?? '');
    const link = /href="(\/[^"]+\/[^"/]+)"/.exec(cells[1] ?? '')?.[1];
    if (cells.length < 5 || !link) return [];
    return [
      {
        department: decode(cells[0] ?? ''),
        code: decode(cells[1] ?? ''),
        title: decode(cells[2] ?? ''),
        lecturer: decode(cells[3] ?? ''),
        term: decode(cells[4] ?? ''),
        path: link,
      },
    ];
  });
  const items = await archiveItems();
  const courses: Course[] = [];
  const report: string[] = [];

  for (const row of rows) {
    const page = await get(`${YALE}${row.path}`, 'text');
    const about =
      /views-label-body">About the Course<\/span><div class="field-content">([\s\S]*?)<\/div>/.exec(
        page,
      )?.[1] ?? '';
    const listed = /session-display-title"><a href="([^"]+)"/.exec(page)?.[1];
    const where = `${row.code} ${row.title}`;
    if (!listed) {
      report.push(`${where}: left out, no sessions on Yale's page`);
      continue;
    }
    // Yale's sessions table leaves lectures out; each session page links the one before and after.
    const link = (html: string, which: 'previous' | 'next') =>
      new RegExp(`field-${which}-session"><div class="field-content"><a href="([^"]+)"`).exec(
        html,
      )?.[1];
    let first = listed;
    for (let guard = 0; guard < 100; guard++) {
      const before = link(await get(`${YALE}${first}`, 'text'), 'previous');
      if (!before) break;
      first = before;
    }
    const sessions: { path: string; html: string }[] = [];
    // Some chains loop back on themselves; a page is read once.
    for (
      let path: string | undefined = first;
      path && sessions.length < 100 && !sessions.some((s) => s.path === path);
    ) {
      const html = await get(`${YALE}${path}`, 'text');
      sessions.push({ path, html });
      path = link(html, 'next');
    }
    const read = await pool(sessions, 8, async ({ path, html }) => {
      const heading = /<h2 class="session-full__title">([\s\S]*?)<\/h2>/.exec(html)?.[1] ?? '';
      const [label = '', ...rest] = decode(heading).split(' - ');
      const audio = /href="([^"]+\.mp3)"/i.exec(html)?.[1];
      // Some pages link a template address instead of a file.
      const url = audio && !/filename\.mp3$/i.test(audio) ? new URL(audio, YALE).href : null;
      const head = url
        ? (JSON.parse(await get(url, 'head')) as {
            status: number;
            type: string | null;
            length: number;
          })
        : null;
      const video = /youtube\.com\/embed\//.test(html);
      // A Credits section in the page body (not the image list PDF) is read by hand.
      const credits = /<h3[^>]*>\s*Credits\s*<\/h3>([\s\S]{0,600})/i.exec(html)?.[1];
      return {
        path,
        label,
        // “Lecture 3” is said by the part's place; another kind of session keeps its name.
        title:
          rest.length === 0
            ? label
            : /^Lecture \d+$/.test(label)
              ? rest.join(' - ')
              : `${label}: ${rest.join(' - ')}`,
        url,
        head,
        video,
        credits: credits ? decode(credits) : null,
      };
    });
    // A session with neither audio nor video, such as an exam, is not a lecture.
    for (const l of read.filter((l) => !l.url && !l.video))
      report.push(`${where}: ${l.label} (${l.title}) skipped, no recording`);
    const lectures = read.filter((l) => l.url || l.video);
    const identifier =
      [...items.entries()]
        .filter(([title]) => normal(row.title).startsWith(title))
        .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null;
    const files = identifier ? await archiveFiles(identifier) : [];
    const missing = lectures.filter((l) => !l.url);
    const failing = lectures.filter(
      (l) => l.url && (l.head?.status !== 200 || !l.head.type?.startsWith('audio/')),
    );
    for (const l of lectures)
      if (l.credits) report.push(`${where}: ${l.label} has credits: ${l.credits.slice(0, 200)}`);
    for (const l of [...missing, ...failing])
      report.push(
        `${where}: ${l.label} (${l.title}) ${l.url ? `answers ${l.head?.status}` : 'has no audio'}`,
      );
    // archive.org's copy of each lecture: the file of the same size as Yale's (the copies were
    // uploaded unchanged, under names that are sometimes out of order), else the one in its place
    // when both have as many files. Matches by place are read by hand in the report.
    const copies = new Map<number, ArchiveFile>();
    for (const [i, l] of lectures.entries()) {
      const size = l.head?.status === 200 ? l.head.length : NaN;
      // Two lectures can be exactly as long; then the one in the same place wins.
      const same = files.filter(
        (f) => Math.abs(f.size - size) < 4096 && ![...copies.values()].includes(f),
      );
      const file = same.find((f) => f === files[i]) ?? same[0];
      if (file) copies.set(i, file);
    }
    if (files.length === lectures.length) {
      const left = files.filter((f) => ![...copies.values()].includes(f));
      for (const [i, l] of lectures.entries()) {
        if (copies.has(i)) continue;
        const file = left.shift();
        if (!file) break;
        copies.set(i, file);
        report.push(`${where}: ${l.label} “${l.title}” taken as “${file.name}” by its place`);
      }
    }
    report.push(
      `${where}: ${lectures.length} lectures, ${missing.length} without audio, ${failing.length} failing at Yale; archive.org ${identifier ?? 'none'} with ${files.length} files, ${copies.size} matched`,
    );

    let host: 'yale' | 'archive';
    let parts: Lecture[];
    if (missing.length === 0 && failing.length === 0) {
      host = 'yale';
      parts = [];
      for (const l of lectures) {
        const i = lectures.indexOf(l);
        let durationMs = copies.get(i)?.length ?? null;
        durationMs ??= await lengthFromHeader(l.url ?? '', l.head?.length ?? 0);
        if (!durationMs) {
          report.push(`${where}: no length for ${l.label}`);
          break;
        }
        parts.push({ title: curly(l.title), page: l.path, audio: l.url ?? '', durationMs });
      }
      if (parts.length !== lectures.length) continue;
    } else if (
      // A lecture Yale offers no audio for at all (some guest lectures) may be held back on
      // purpose; only files that fail to answer are taken from archive.org.
      missing.length === 0 &&
      identifier &&
      copies.size === lectures.length &&
      [...copies.values()].every((f) => f.length)
    ) {
      host = 'archive';
      parts = lectures.map((l, i) => {
        const file = copies.get(i) as ArchiveFile;
        return {
          title: curly(l.title),
          page: l.path,
          audio: `${ARCHIVE}/download/${identifier}/${encodeURIComponent(file.name)}`,
          durationMs: file.length ?? 0,
        };
      });
    } else {
      report.push(`${where}: left out, not every lecture has audio`);
      continue;
    }
    courses.push({
      // Yale recorded Financial Markets twice under one code.
      id:
        row.code.toLowerCase().replace(/\s+/g, '-') +
        (rows.filter((r) => r.code === row.code).length > 1 ? `-${row.term.slice(-4)}` : ''),
      code: row.code,
      title: curly(row.title),
      lecturer: row.lecturer,
      term: row.term,
      department: row.department,
      page: row.path,
      description: curly(decode(about.replace(/<\/p>\s*<p>/g, '\n\n'))),
      archive: identifier,
      host,
      lectures: parts,
    });
  }

  const source = `// Written by scripts/open-lectures.mts from Open Yale Courses and archive.org, then read by hand.
// Paths are on Yale's site; audio is Yale's own MP3 or, where those fail, archive.org's copy.
import type { Course } from './course';

export const COURSES: Course[] = ${JSON.stringify(courses)};
`;
  const options = (await prettier.resolveConfig(OUT)) ?? {};
  writeFileSync(OUT, await prettier.format(source, { ...options, filepath: OUT }));
  console.log(report.join('\n'));
  console.log(
    `\n${courses.length} courses: ${courses.filter((c) => c.host === 'yale').length} from Yale, ${courses.filter((c) => c.host === 'archive').length} from archive.org`,
  );
}

await main();
