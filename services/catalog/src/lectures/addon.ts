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
 * hands out the addresses, and asks nobody at runtime.
 */
export const lecturesManifest: Manifest = {
  id: 'app.lelap.lectures',
  version: '1.0.0',
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

export function streamOf(course: Course): Stream {
  const yale = course.host === 'yale';
  return {
    // One stream per course, not both hosts: places are kept by this key.
    sourceKey: yale ? `oyc:${course.id}` : `archive:${course.archive}`,
    name: 'Open Yale Courses',
    title: yale ? `${course.code}, ${course.term}` : `${course.code}, ${course.term}, archive.org`,
    mime: 'audio/mpeg',
    downloadable: true,
    parts: course.lectures.map((l) => ({ url: l.audio, title: l.title, durationMs: l.durationMs })),
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

export function createLecturesAddon(courses: Course[] = COURSES): Addon {
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
      stream({ id }): StreamResponse {
        const course = byId.get(id);
        return { streams: course ? [streamOf(course)] : [], cacheMaxAge: TTL.reference };
      },
    },
    { basePath: BASE_PATH, onError: (error) => console.error(error) },
  );
}
