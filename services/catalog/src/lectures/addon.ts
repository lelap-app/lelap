import {
  type Addon,
  type CatalogResponse,
  createAddon,
  type Manifest,
  type Meta,
  type MetaPreview,
  type Stream,
  type StreamResponse,
} from '@lelap/sdk';

import { searchWords, truncate, yearOf } from '../text';
import { TTL } from '../upstream';
import { type Course, creditLine, LICENCE, TERMS, YALE } from './course';
import { COURSES } from './courses';
import { transcriptPath } from './transcript';

export const BASE_PATH = '/lectures';
export const PREFIX = 'oyc:';
const CATALOG = 'open-yale-courses';
const PAGE_SIZE = 30;
const LICENCE_URL = 'https://creativecommons.org/licenses/by-nc-sa/3.0/us/';

const departments = [...new Set(COURSES.map((c) => c.department))].sort((a, b) =>
  a.localeCompare(b, 'en'),
);

/**
 * Open lectures (M132): complete university courses from a hand-kept list, one course a book and
 * one lecture a part. Audio streams from the publisher (Yale) or archive.org; this add-on only
 * hands out the addresses. Since M136 each lecture has its transcript, read from Yale's lecture
 * page by `transcript.ts` when first asked for.
 */
export const lecturesManifest: Manifest = {
  id: 'app.lelap.lectures',
  version: '1.1.0',
  protocol: 1,
  name: 'Open lectures',
  description:
    'Complete Open Yale Courses as books, one lecture per part, under Yale’s Creative Commons BY-NC-SA licence.',
  types: ['audiobook'],
  resources: [
    'catalog',
    { name: 'meta', types: ['audiobook'], idPrefixes: [PREFIX] },
    { name: 'stream', types: ['audiobook'], idPrefixes: [PREFIX] },
  ],
  idPrefixes: [PREFIX],
  catalogs: [
    {
      type: 'audiobook',
      id: CATALOG,
      name: 'Open Yale Courses',
      extra: [{ name: 'genre', options: departments }, { name: 'search' }, { name: 'skip' }],
    },
  ],
};

const durationOf = (course: Course) => course.lectures.reduce((t, l) => t + l.durationMs, 0);

/** The course's own text, then Yale's credit line, the licence and the terms. */
export function descriptionOf(course: Course): string {
  return [
    course.description,
    creditLine(course),
    `${LICENCE}: ${LICENCE_URL}\nOpen Yale Courses terms of use: ${TERMS}`,
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n');
}

function previewOf(course: Course): MetaPreview {
  const year = yearOf(course.term);
  return {
    id: `${PREFIX}${course.id}`,
    type: 'audiobook',
    name: course.title,
    author: course.lecturer,
    description: truncate(course.description, 300),
    durationMs: durationOf(course),
    ...(year ? { year } : {}),
  };
}

export function metaOf(course: Course): Meta {
  return {
    ...previewOf(course),
    description: descriptionOf(course),
    language: 'en',
    genres: [course.department],
    link: `${YALE}${course.page}`,
  };
}

/** `origin` is where this service answers, for each lecture's transcript (M136). */
export function streamOf(course: Course, origin: string): Stream {
  const yale = course.host === 'yale';
  return {
    // One stream per course, not both hosts: places are kept by this key.
    sourceKey: yale ? `oyc:${course.id}` : `archive:${course.archive}`,
    name: 'Open Yale Courses',
    title: yale ? `${course.code}, ${course.term}` : `${course.code}, ${course.term}, archive.org`,
    mime: 'audio/mpeg',
    downloadable: true,
    parts: course.lectures.map((l, i) => ({
      url: l.audio,
      title: l.title,
      durationMs: l.durationMs,
      // Text from Yale's lecture page, through this service; the audio never is.
      transcripts: [
        {
          url: `${origin}${transcriptPath(BASE_PATH, course, i + 1)}`,
          type: 'text/plain',
          language: 'en',
        },
      ],
    })),
  };
}

/** Every word of the search in the course's title, lecturer, code or department. */
function matches(course: Course, words: string[]): boolean {
  const text = searchWords(
    `${course.title} ${course.lecturer} ${course.code} ${course.department}`,
    100,
  );
  return words.every((word) => text.some((t) => t.startsWith(word)));
}

/**
 * `origin`: this service's public origin, when requests arrive under another (Docker behind a
 * proxy); otherwise each request's own.
 */
export function createLecturesAddon(courses: Course[] = COURSES, origin?: string): Addon {
  const byId = new Map(courses.map((c) => [`${PREFIX}${c.id}`, c]));
  return createAddon(
    {
      manifest: lecturesManifest,
      catalog({ id, extra }): CatalogResponse {
        if (id !== CATALOG) return { metas: [], cacheMaxAge: TTL.reference };
        const words = extra.search ? searchWords(extra.search) : [];
        if (extra.search !== undefined && words.length === 0)
          return { metas: [], cacheMaxAge: TTL.reference };
        const skip = Math.max(0, parseInt(extra.skip ?? '0', 10) || 0);
        const metas = courses
          .filter((c) => !extra.genre || c.department === extra.genre)
          .filter((c) => matches(c, words))
          .slice(skip, skip + PAGE_SIZE)
          .map(previewOf);
        return { metas, cacheMaxAge: TTL.reference };
      },
      meta({ id }) {
        const course = byId.get(id);
        return course ? { meta: metaOf(course), cacheMaxAge: TTL.reference } : null;
      },
      stream({ id, request }): StreamResponse {
        const course = byId.get(id);
        const base = origin ?? new URL(request.url).origin;
        return { streams: course ? [streamOf(course, base)] : [], cacheMaxAge: TTL.reference };
      },
    },
    { basePath: BASE_PATH, onError: (error) => console.error(error) },
  );
}
