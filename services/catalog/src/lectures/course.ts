import { z } from 'zod';

/** Yale's site; course and lecture pages in the list are paths on it. */
export const YALE = 'https://oyc.yale.edu';
export const TERMS = `${YALE}/terms`;
export const LICENCE = 'Creative Commons BY-NC-SA 3.0';

// Audio is only ever an address on the publisher's host or archive.org, never on ours.
const Audio = z
  .url({ protocol: /^https$/ })
  .refine((url) => /^https:\/\/(oyc\.yale\.edu|archive\.org)\//.test(url), {
    message: 'Audio comes from oyc.yale.edu or archive.org',
  });
const YalePath = z.string().regex(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/);

export const Lecture = z.object({
  title: z.string().min(1),
  /** Yale's lecture page. */
  page: YalePath,
  audio: Audio,
  durationMs: z.number().int().positive(),
});
export type Lecture = z.infer<typeof Lecture>;

/** One course of the hand-kept list, as `scripts/open-lectures.mts` writes it. */
export const Course = z
  .object({
    /**
     * Yale's course code in lower case, such as `hsar-252`, and the year where Yale recorded a
     * course twice (`econ-252-2011`); the item ID is `oyc:` and this.
     */
    id: z.string().regex(/^[a-z]+-\d+[a-z]?(-\d{4})?$/),
    /** As Yale writes it, such as `HSAR 252`. */
    code: z.string().min(1),
    title: z.string().min(1),
    lecturer: z.string().min(1),
    /** When it was recorded, such as `Spring 2009`. */
    term: z.string().regex(/^(Spring|Summer|Fall) \d{4}$/),
    department: z.string().min(1),
    /** Yale's course page. */
    page: YalePath,
    description: z.string(),
    /** The archive.org copy, from the `openyalecourses` collection. */
    archive: z.string().nullable(),
    /** Where the audio streams from: Yale's own files, or archive.org's copies where those fail. */
    host: z.enum(['yale', 'archive']),
    lectures: z.array(Lecture).min(1),
  })
  .refine(
    (course) =>
      course.lectures.every((l) =>
        course.host === 'yale'
          ? l.audio.startsWith(`${YALE}/`)
          : l.audio.startsWith(`https://archive.org/download/${course.archive}/`),
      ),
    { message: 'Every lecture of a course streams from the same host', path: ['lectures'] },
  );
export type Course = z.infer<typeof Course>;

/** Yale's required credit, in the form its terms set out (sections 4 to 6). */
export function creditLine(course: Course): string {
  return `${course.lecturer}, ${course.title} (Yale University: Open Yale Courses), http://oyc.yale.edu. License: Creative Commons BY-NC-SA`;
}
