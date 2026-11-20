import { CORS_HEADERS } from '@lelap/sdk';

import type { Platform } from '../upstream';
import { type Course, creditLine, YALE } from './course';

/** A month: Yale's transcripts were written once, years ago. */
export const TRANSCRIPT_TTL = 30 * 24 * 60 * 60;
const TIMEOUT_MS = 10_000;
// A lecture page is about 60 kB; anything far larger is not one.
const MAX_PAGE_BYTES = 2_000_000;
const NONE_TTL = 24 * 60 * 60;

/** The body as text, or null once it passes `max` bytes, without reading the rest. */
async function readLimited(response: Response, max: number): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Where a lecture's transcript is served, under the add-on's base path; `n` counts from 1. */
export const transcriptPath = (basePath: string, course: Course, n: number) =>
  `${basePath}/transcript/${course.id}/${n}.txt`;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : +name.slice(1);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * The transcript on a Yale lecture page (its `inline_content` block) as paragraphs of plain text:
 * the lecture's heading, chapter headings with their times, then what was said. Null when the page
 * has none.
 */
export function transcriptOfPage(html: string): string[] | null {
  const start = html.indexOf('id="inline_content"');
  if (start < 0) return null;
  const open = html.indexOf('>', start);
  const backToTop = html.indexOf('href="#transcript-top"', open);
  const block = html.slice(open + 1, backToTop < 0 ? undefined : backToTop);
  const paragraphs = block
    // The course's title; the credit line names the course.
    .replace(/<h1\b[\s\S]*?<\/h1>/gi, '')
    .replace(/<a\b[^>]*$/i, '')
    .replace(/<\/?(p|h[1-6]|div|br|li|ul|ol|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => decode(line).replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
  return paragraphs.length > 0 ? paragraphs : null;
}

/** What the route serves: Yale's credit line first, then the transcript. */
export function transcriptText(course: Course, paragraphs: string[]): string {
  return `${[creditLine(course), ...paragraphs].join('\n\n')}\n`;
}

const text = (body: string, status: number, maxAge?: number) =>
  new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      ...(maxAge !== undefined ? { 'Cache-Control': `public, max-age=${maxAge}` } : {}),
    },
  });

/**
 * `GET {basePath}/transcript/{course}/{n}.txt` (M136): lecture `n`'s transcript, fetched from
 * Yale's lecture page and cached for a month. Text only; audio never comes through here.
 */
export function transcriptRoute(
  platform: Pick<Platform, 'fetch' | 'cache'>,
  courses: Course[],
  basePath: string,
  userAgent: string,
): (request: Request) => Promise<Response> {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const route = new RegExp(`^${basePath}/transcript/([a-z0-9-]+)/([1-9]\\d{0,3})\\.txt$`);
  return async (request) => {
    const url = new URL(request.url);
    const match = route.exec(url.pathname);
    const course = match ? byId.get(match[1] ?? '') : undefined;
    const lecture = course?.lectures[Number(match?.[2]) - 1];
    if (!course || !lecture) return text('No such lecture.\n', 404);

    const key = `https://catalog.cache${url.pathname}`;
    const cached = await platform.cache?.match(key).catch(() => undefined);
    // A copy: the app's middleware sets headers, and a cached answer's may be immutable.
    if (cached) return new Response(cached.body, cached);

    const page = await platform
      .fetch(`${YALE}${lecture.page}`, {
        headers: { Accept: 'text/html', 'User-Agent': userAgent },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      .catch(() => null);
    if (!page) return text('Open Yale Courses did not answer.\n', 502);
    if (page.status === 404) return text('Yale has no page for this lecture.\n', 404);
    if (!page.ok) return text(`Open Yale Courses answered HTTP ${page.status}.\n`, 502);
    const html = await readLimited(page, MAX_PAGE_BYTES);
    const paragraphs = html === null ? null : transcriptOfPage(html);
    if (!paragraphs) {
      // Kept a day, so a lecture without one doesn't send every listener to Yale again.
      const none = text('This lecture has no transcript.\n', 404, NONE_TTL);
      await platform.cache?.put(key, none.clone()).catch(() => undefined);
      return none;
    }

    const result = text(transcriptText(course, paragraphs), 200, TRANSCRIPT_TTL);
    await platform.cache?.put(key, result.clone()).catch(() => undefined);
    return result;
  };
}
