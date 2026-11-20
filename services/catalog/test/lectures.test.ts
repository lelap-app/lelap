import { readFileSync } from 'node:fs';

import { CatalogResponse, Manifest, MetaResponse, WebStreamResponse } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { createLecturesAddon, lecturesManifest } from '../src/lectures/addon';
import { transcriptOfPage, transcriptText } from '../src/lectures/transcript';
import type { ResponseCache } from '../src/upstream';
import { Course, creditLine } from '../src/lectures/course';
import { COURSES } from '../src/lectures/courses';
import { fixture } from './helpers';

const BASE = 'https://addons.test/lectures';
const ROMAN = 'oyc:hsar-252';

const recorded = (name: string) => readFileSync(`${import.meta.dirname}/fixtures/${name}`, 'utf8');
const archive = fixture('archive-metadata-oyc_Roman_Architecture.json') as {
  files: { name: string; length: string; size: string; title: string }[];
};

async function get(route: string) {
  const response = await createLecturesAddon().fetch(new Request(`${BASE}/${route}`));
  return { status: response.status, body: (await response.json()) as unknown };
}

const roman = () => {
  const course = COURSES.find((c) => c.id === 'hsar-252');
  if (!course) throw new Error('Roman Architecture is not on the list');
  return course;
};

describe('the hand-kept list', () => {
  it('has only whole courses with audio and a length for every lecture', () => {
    expect(COURSES.length).toBeGreaterThan(0);
    for (const course of COURSES) expect(() => Course.parse(course), course.code).not.toThrow();
    const ids = COURSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never depends on video', () => {
    const text = JSON.stringify(COURSES);
    expect(text).not.toMatch(/youtube|youtu\.be|\.mp4|OpenYaleCourse/i);
  });

  it('streams each course from one host only', () => {
    for (const course of COURSES) {
      const hosts = new Set(course.lectures.map((l) => new URL(l.audio).host));
      expect(hosts.size, course.code).toBe(1);
    }
  });

  it('lists Roman Architecture in Yale’s order, with archive.org’s lengths for the same recordings', () => {
    const course = roman();
    expect(course.lectures).toHaveLength(24);
    // Yale's sessions table, as recorded, leaves lectures out; those it names are in the same order.
    const listed = [
      ...recorded('yale-hsar-252-sessions.html').matchAll(
        /href="(\/history-art\/hsar-252\/[^"]+)"/g,
      ),
    ].map((m) => m[1]);
    expect(listed.length).toBeLessThan(24);
    const pages = course.lectures.map((l) => l.page);
    expect(pages.filter((p) => listed.includes(p))).toEqual(listed);
    expect(pages[0]).toBe('/history-art/hsar-252/lecture-1');
    // Yale's lecture page links the MP3 the list streams.
    const audio = /href="([^"]+\.mp3)"/.exec(recorded('yale-hsar-252-lecture-1-media.html'))?.[1];
    expect(course.lectures[0]?.audio).toBe(`https://oyc.yale.edu${audio}`);
    // archive.org's copy holds the same recordings, numbered with Paper Topics last; Yale held
    // that session after lecture 13. Its file list gives their lengths.
    const lengths = (files: typeof archive.files) =>
      files.map((f) => Math.round(parseFloat(f.length) * 1000));
    const files = [...archive.files].sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { numeric: true }),
    );
    expect(course.lectures[13]?.page).toBe('/history-art/hsar-252/paper-topics');
    expect(course.lectures.map((l) => l.durationMs)).toEqual(
      lengths([...files.slice(0, 13), files[23], ...files.slice(13, 23)].flatMap((f) => f ?? [])),
    );
  });
});

describe('the Open lectures add-on', () => {
  it('serves a valid manifest under /lectures', async () => {
    const { status, body } = await get('manifest.json');
    expect(status).toBe(200);
    const manifest = Manifest.parse(body);
    expect(manifest.id).toBe('app.lelap.lectures');
    expect(manifest).toMatchObject(lecturesManifest);
    const genres = manifest.catalogs[0]?.extra?.find((e) => e.name === 'genre')?.options;
    expect(genres).toContain('History of Art');
  });

  it('lists the courses, by department and by search', async () => {
    const all = CatalogResponse.parse((await get('catalog/audiobook/open-yale-courses.json')).body);
    expect(all.metas.length).toBe(Math.min(30, COURSES.length));
    const art = CatalogResponse.parse(
      (await get('catalog/audiobook/open-yale-courses/genre=History%20of%20Art.json')).body,
    );
    expect(art.metas.map((m) => m.id)).toContain(ROMAN);
    const found = CatalogResponse.parse(
      (await get('catalog/audiobook/open-yale-courses/search=roman%20kleiner.json')).body,
    );
    expect(found.metas.map((m) => m.id)).toEqual([ROMAN]);
    const nothing = CatalogResponse.parse(
      (await get('catalog/audiobook/open-yale-courses/search=zzzz.json')).body,
    );
    expect(nothing.metas).toEqual([]);
    const later = CatalogResponse.parse(
      (await get('catalog/audiobook/open-yale-courses/skip=30.json')).body,
    );
    expect(later.metas.length).toBe(Math.max(0, Math.min(30, COURSES.length - 30)));
  });

  it('shows Yale’s credit line, the licence and the terms on every course, and links its page', async () => {
    for (const course of COURSES) {
      const { meta } = MetaResponse.parse((await get(`meta/audiobook/oyc:${course.id}.json`)).body);
      expect(meta.link).toBe(`https://oyc.yale.edu${course.page}`);
      expect(meta.author).toBe(course.lecturer);
      expect(meta.description).toContain(
        `${creditLine(course)}\n\nCreative Commons BY-NC-SA 3.0: https://creativecommons.org/licenses/by-nc-sa/3.0/us/\nOpen Yale Courses terms of use: https://oyc.yale.edu/terms`,
      );
      expect(meta.description?.endsWith('https://oyc.yale.edu/terms')).toBe(true);
    }
    expect(creditLine(roman())).toBe(
      'Diana E. E. Kleiner, Roman Architecture (Yale University: Open Yale Courses), http://oyc.yale.edu. License: Creative Commons BY-NC-SA',
    );
  });

  it('streams a course as one book with a part per lecture', async () => {
    const { streams } = WebStreamResponse.parse(
      (await get(`stream/audiobook/${encodeURIComponent(ROMAN)}.json`)).body,
    );
    expect(streams).toHaveLength(1);
    const stream = streams[0];
    if (!stream || !('parts' in stream)) throw new Error('Expected parts');
    expect(stream.parts).toHaveLength(24);
    expect(stream.parts[0]).toEqual({
      url: roman().lectures[0]?.audio,
      title: 'Introduction to Roman Architecture',
      durationMs: 2_550_910,
      transcripts: [
        {
          url: 'https://addons.test/lectures/transcript/hsar-252/1.txt',
          type: 'text/plain',
          language: 'en',
        },
      ],
    });
    expect(stream.parts[23]?.transcripts?.[0]?.url).toBe(
      'https://addons.test/lectures/transcript/hsar-252/24.txt',
    );
    expect(stream.parts[13]?.title).toBe(
      'Paper Topics: Discovering the Roman Provinces and Designing a Roman City',
    );
    expect(stream.parts[23]?.title).toBe('Rome of Constantine and a New Rome');
  });

  it('answers nothing for an ID it does not know', async () => {
    expect((await get('meta/audiobook/oyc:none-1.json')).status).toBe(404);
    const { body } = await get('stream/audiobook/oyc:none-1.json');
    expect(body).toMatchObject({ streams: [] });
  });
});

describe('lecture transcripts (M136)', () => {
  const page = recorded('yale-hsar-252-lecture-1-transcript.html');
  const TRANSCRIPT = 'https://addons.test/lectures/transcript/hsar-252/1.txt';

  function serve(answer: (url: URL) => Response, env = {}) {
    const asked: URL[] = [];
    const store = new Map<string, Response>();
    const cache: ResponseCache = {
      match: async (key) => store.get(key)?.clone(),
      put: async (key, response) => void store.set(key, response),
    };
    const fetch = async (url: string) => {
      asked.push(new URL(url));
      return answer(new URL(url));
    };
    return { app: createApp({ fetch, cache }, env), asked };
  }

  it('reads the transcript from Yale’s lecture page, without the page around it', () => {
    const paragraphs = transcriptOfPage(page) ?? [];
    expect(paragraphs[0]).toBe('HSAR 252 - Lecture 1 - Introduction to Roman Architecture');
    expect(paragraphs[1]).toBe('Chapter 1. Introduction: Roman Urbanism [00:00:00]');
    expect(paragraphs[2]).toMatch(
      /^Professor Diana E\. E\. Kleiner: Welcome to Roman Architecture\. I'm Professor Kleiner,/,
    );
    expect(paragraphs).toContain('Chapter 2. The Urban Grid and Public Architecture [00:09:47]');
    expect(paragraphs.some((p) => p.includes('the location of the cardo and the decumanus.'))).toBe(
      true,
    );
    expect(paragraphs.at(-1)).toBe('[end of transcript]');
    const text = paragraphs.join('\n');
    expect(text).not.toMatch(/[<>]|Back to Top|^Roman Architecture$/m);
    expect(transcriptOfPage(recorded('yale-hsar-252-lecture-1-media.html'))).toBeNull();
    expect(
      transcriptOfPage('<div id="inline_content"><p>A &amp; B &#8217;s &rsquo; &bogus;</p></div>'),
    ).toEqual(['A & B ’s ’ &bogus;']);
  });

  it('puts Yale’s credit line first', () => {
    expect(transcriptText(roman(), ['One.', 'Two.'])).toBe(
      `${creditLine(roman())}\n\nOne.\n\nTwo.\n`,
    );
  });

  it('serves it as plain text, cached for a month, asking Yale once', async () => {
    const { app, asked } = serve((url) =>
      url.pathname === '/history-art/hsar-252/lecture-1'
        ? new Response(page, { headers: { 'Content-Type': 'text/html' } })
        : new Response('missing', { status: 404 }),
    );
    const response = await app.request(TRANSCRIPT);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=2592000');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const text = await response.text();
    expect(text.startsWith(`${creditLine(roman())}\n\nHSAR 252 - Lecture 1 -`)).toBe(true);
    expect(text.endsWith('[end of transcript]\n')).toBe(true);

    const again = await app.request(TRANSCRIPT);
    expect(await again.text()).toBe(text);
    expect(asked.map((u) => u.href)).toEqual([
      'https://oyc.yale.edu/history-art/hsar-252/lecture-1',
    ]);
  });

  it('answers 404 for a lecture it does not know or a page without a transcript', async () => {
    const { app, asked } = serve(() => new Response('<html><body>No text</body></html>'));
    for (const route of ['hsar-252/25.txt', 'hsar-252/0.txt', 'none-1/1.txt', 'hsar-252/1.mp3'])
      expect((await app.request(`https://addons.test/lectures/transcript/${route}`)).status).toBe(
        404,
      );
    expect(asked).toEqual([]);
    expect((await app.request(TRANSCRIPT)).status).toBe(404);
    const again = await app.request(TRANSCRIPT);
    expect(again.status).toBe(404);
    expect(again.headers.get('Cache-Control')).toBe('public, max-age=86400');
    expect(asked).toHaveLength(1);
  });

  it('refuses a page far larger than a lecture page', async () => {
    const { app } = serve(() => new Response(`${page}${' '.repeat(2_000_001)}`));
    expect((await app.request(TRANSCRIPT)).status).toBe(404);
  });

  it('answers 502 when Yale fails, and caches nothing', async () => {
    let up = false;
    const { app, asked } = serve(() =>
      up ? new Response(page) : new Response('down', { status: 503 }),
    );
    expect((await app.request(TRANSCRIPT)).status).toBe(502);
    up = true;
    expect((await app.request(TRANSCRIPT)).status).toBe(200);
    expect(asked).toHaveLength(2);
  });

  it('names the configured origin in the stream behind a proxy', async () => {
    const { app } = serve(() => new Response(page), {
      CATALOG_ORIGIN: 'https://catalog.example.org',
    });
    const response = await app.request(
      `http://internal:8787/lectures/stream/audiobook/${encodeURIComponent(ROMAN)}.json`,
    );
    const { streams } = WebStreamResponse.parse(await response.json());
    const stream = streams[0];
    if (!stream || !('parts' in stream)) throw new Error('Expected parts');
    expect(stream.parts[1]?.transcripts?.[0]?.url).toBe(
      'https://catalog.example.org/lectures/transcript/hsar-252/2.txt',
    );
  });
});
