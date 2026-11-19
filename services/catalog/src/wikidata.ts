import {
  fold,
  orderSeriesVolumes,
  type SeriesList,
  type SeriesListVolume,
  sameAuthors,
  splitAuthors,
} from '@lelap/sdk';
import { z } from 'zod';

import { TTL, type Upstream } from './upstream';

// Whole series from Wikidata (M127): open data under CC0, no key. A name is looked up with
// `wbsearchentities`, then one SPARQL query reads the candidates' parts. Nothing about the
// listener is sent beyond the series' name, its author and the language for the titles.

export const SEARCH_URL = 'https://www.wikidata.org/w/api.php';
export const SPARQL_URL = 'https://query.wikidata.org/sparql';
const SPARQL_HEADERS = { Accept: 'application/sparql-results+json' };

/**
 * The kinds of item (P31) that count as a book of the series, so a TV series, its seasons and the
 * films of the same name never do: written work, literary work, book, novel, novella, short story,
 * short story collection. Listed rather than followed through subclasses (P279*), which is too
 * slow for the query service.
 */
const WRITTEN_WORKS = ['Q47461344', 'Q7725634', 'Q571', 'Q8261', 'Q149537', 'Q49084', 'Q1279564'];
const CANDIDATES = 10;
const ENTITY = /^Q\d{1,12}$/;
const OL_WORK = /^OL\d{1,12}W$/;
const LANGUAGE = /^[a-z]{2,3}$/;

export type SeriesQuery = {
  name: string;
  author?: string | undefined;
  /** The profile's language, such as `da`; titles in it come first. */
  language?: string | undefined;
  /** An Open Library work of the series, such as `OL82563W`. */
  olWork?: string | undefined;
};

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const SearchAnswer = z.object({
  search: z
    .array(
      z.object({
        id: z.string(),
        label: lenient(z.string()),
        match: lenient(z.object({ text: lenient(z.string()) })),
        aliases: lenient(z.array(z.string())),
      }),
    )
    .catch([]),
});

const Value = z.object({ value: z.string(), 'xml:lang': z.string().optional() });
const SparqlAnswer = z.object({
  results: z.object({ bindings: z.array(z.record(z.string(), Value)).catch([]) }),
});
type Binding = Record<string, z.infer<typeof Value>>;

/** The language code to ask with: two or three letters, `en` otherwise. */
export function languageOf(language: string | undefined): string {
  const base = (language ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return LANGUAGE.test(base) ? base : 'en';
}

export function searchUrl(name: string, language: string): string {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language,
    uselang: language,
    type: 'item',
    limit: String(CANDIDATES),
    format: 'json',
  });
  return `${SEARCH_URL}?${params}`;
}

const sparqlUrl = (query: string) =>
  `${SPARQL_URL}?${new URLSearchParams({ query: query.replace(/\s+/g, ' ').trim(), format: 'json' })}`;

/** The series an Open Library work is part of, by Wikidata's Open Library ID (P648). */
export function workSeriesUrl(olWork: string): string {
  if (!OL_WORK.test(olWork)) throw new Error(`Not an Open Library work: ${olWork}`);
  return sparqlUrl(
    `SELECT DISTINCT ?series WHERE { ?work wdt:P648 "${olWork}" ; wdt:P179 ?series . }`,
  );
}

/**
 * The parts of each candidate series that are written works: the series statement's ordinal
 * (P1545), the first release (P577), the original language (P407), titles, the authors' names,
 * and the series' own names. Each kind of fact in its own query, so rows don't multiply.
 */
export function partsUrls(candidates: readonly string[], language: string): string[] {
  const ids = candidates.filter((id) => ENTITY.test(id));
  if (ids.length === 0) throw new Error('No candidates');
  const langs = [...new Set([language, 'en', 'mul'])].map((l) => `"${l}"`).join(', ');
  // The candidates in every branch: the query service doesn't carry an outer VALUES into a UNION.
  const series = `VALUES ?series { ${ids.map((id) => `wd:${id}`).join(' ')} }`;
  const part = `${series} ?st ps:P179 ?series . ?work p:P179 ?st .`;
  const kinds = WRITTEN_WORKS.map((id) => `wd:${id}`).join(', ');
  // Four small queries: as one UNION the query service takes longer than its time limit.
  return [
    `SELECT ?series ?work ?kind ?ordinal ?date ?lang WHERE { ${part}
      ?work wdt:P31 ?kind . FILTER(?kind IN (${kinds}))
      OPTIONAL { ?st pq:P1545 ?ordinal } OPTIONAL { ?work wdt:P577 ?date }
      OPTIONAL { ?work wdt:P407 ?l . ?l wdt:P218 ?lang } }`,
    `SELECT ?series ?work ?title WHERE { ${part} ?work rdfs:label ?title .
      OPTIONAL { ?work wdt:P407 ?ol . ?ol wdt:P218 ?olang }
      FILTER(LANG(?title) IN (${langs}) || LANG(?title) = ?olang) }`,
    `SELECT ?series ?work ?author WHERE { ${part} ?work wdt:P50 ?a .
      VALUES ?ap { rdfs:label skos:altLabel } ?a ?ap ?author . FILTER(LANG(?author) IN (${langs})) }`,
    `SELECT ?series ?name WHERE { ${series} VALUES ?sp { rdfs:label skos:altLabel }
      ?series ?sp ?name . FILTER(LANG(?name) IN (${langs})) }`,
  ].map(sparqlUrl);
}

const entity = (binding: Binding, key: string) =>
  binding[key]?.value.replace(/^https?:\/\/www\.wikidata\.org\/entity\//, '') ?? '';

/** How series names compare, as the app's `seriesKey`: folded, no leading article or “series”. */
export function nameKey(name: string): string {
  return fold(name)
    .replace(/^(the|a|an) /, '')
    .replace(/ series$/, '')
    .trim();
}

type Work = {
  id: string;
  ordinal: string | null;
  date: string | null;
  original: string | null;
  titles: Map<string, string>;
  authors: Set<string>;
};

type Candidate = { id: string; names: Map<string, string>; works: Map<string, Work> };

/** The SPARQL answer by series, then by work. */
export function readParts(answers: readonly unknown[]): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  const bindings = answers.flatMap((data) => {
    const parsed = SparqlAnswer.safeParse(data);
    return parsed.success ? (parsed.data.results.bindings as Binding[]) : [];
  });
  const candidateOf = (seriesId: string) => {
    const candidate = out.get(seriesId) ?? { id: seriesId, names: new Map(), works: new Map() };
    out.set(seriesId, candidate);
    return candidate;
  };
  // Only rows with a written kind make a work; titles and authors then attach to those.
  for (const b of bindings) {
    const seriesId = entity(b, 'series');
    const workId = entity(b, 'work');
    if (!ENTITY.test(seriesId) || !ENTITY.test(workId) || !b.kind) continue;
    const candidate = candidateOf(seriesId);
    if (!candidate.works.has(workId))
      candidate.works.set(workId, {
        id: workId,
        ordinal: null,
        date: null,
        original: null,
        titles: new Map(),
        authors: new Set(),
      });
  }
  for (const b of bindings) {
    const seriesId = entity(b, 'series');
    if (!ENTITY.test(seriesId)) continue;
    const candidate = candidateOf(seriesId);
    const name = b.name;
    if (name?.['xml:lang'] && !candidate.names.has(name['xml:lang']))
      candidate.names.set(name['xml:lang'], name.value);
    const work = candidate.works.get(entity(b, 'work'));
    if (!work) continue;
    const ordinal = b.ordinal?.value.trim();
    if (ordinal && work.ordinal === null) work.ordinal = ordinal;
    const date = /^-?\d{4}(-\d{2}-\d{2})?/.exec(b.date?.value ?? '')?.[0];
    // The earliest release, as a work can list one per country.
    if (date && !date.startsWith('-') && (work.date === null || date < work.date)) work.date = date;
    const lang = b.lang?.value;
    if (lang && LANGUAGE.test(lang) && work.original === null) work.original = lang;
    const title = b.title;
    if (title?.['xml:lang'] && !work.titles.has(title['xml:lang']))
      work.titles.set(title['xml:lang'], title.value);
    if (b.author?.value) work.authors.add(b.author.value);
  }
  return out;
}

/** A year alone when Wikidata only knows the year (it writes 1 January then). */
function released(date: string | null): string | undefined {
  if (!date) return undefined;
  return date.endsWith('-01-01') ? date.slice(0, 4) : date;
}

/** The title in the asked language, else the original language, else English, else any. */
function pick(titles: Map<string, string>, order: readonly (string | null)[]): string | undefined {
  for (const lang of order) if (lang && titles.has(lang)) return titles.get(lang);
  return titles.get('mul') ?? titles.values().next().value;
}

/** A Wikidata label that is only the item's ID, as some new items have. */
const bare = (title: string | undefined) => !title || ENTITY.test(title);

/** One series as the protocol lists it; works by more than one title appear once. */
export function toSeriesList(candidate: Candidate, language: string): SeriesList | null {
  const all: SeriesListVolume[] = [];
  // Numbered works first, so the same title twice (a play and its book) keeps the numbered one.
  const works = [...candidate.works.values()].sort(
    (a, b) => Number(a.ordinal === null) - Number(b.ordinal === null),
  );
  for (const work of works) {
    const title = pick(work.titles, [language, work.original, 'en']);
    if (!title || bare(title)) continue;
    const titles: Record<string, string> = {};
    for (const lang of new Set([language, work.original, 'en'])) {
      const value = lang ? work.titles.get(lang) : undefined;
      if (lang && value) titles[lang] = value;
    }
    const year = released(work.date);
    all.push({
      title,
      ...(Object.keys(titles).length > 0 ? { titles } : {}),
      ...(work.ordinal && work.ordinal.length <= 20 ? { position: work.ordinal } : {}),
      ...(year ? { released: year } : {}),
      externalIds: { wikidata: work.id },
    });
  }
  const seen = new Set<string>();
  const volumes = orderSeriesVolumes(
    all.filter((v) => {
      const key = fold(v.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
  if (volumes.length === 0) return null;
  const name = pick(candidate.names, [language, 'en']) ?? volumes[0]?.title ?? candidate.id;
  return {
    name,
    id: `wikidata:${candidate.id}`,
    link: `https://www.wikidata.org/wiki/${candidate.id}`,
    volumes: volumes.slice(0, 500),
  };
}

const writtenBy = (work: Work, authors: readonly string[]) =>
  [...work.authors].some((name) => sameAuthors(authors, splitAuthors(name)));

/**
 * The series a name and author mean. A candidate counts when one of its names is the asked one
 * (or an Open Library work of the series names it) and, with an author, when at least one of its
 * books is by them; the one with the most such books wins.
 */
export async function findSeries(
  upstream: Upstream,
  query: SeriesQuery,
): Promise<SeriesList | null> {
  const name = query.name.trim();
  const language = languageOf(query.language);
  const wanted = nameKey(name);
  if (!wanted) return null;
  const search = SearchAnswer.safeParse(
    await upstream.json(searchUrl(name, language), { ttl: TTL.reference }),
  );
  const found = search.success ? search.data.search : [];
  const named = new Set(
    found
      .filter((r) =>
        [r.label, r.match?.text, ...(r.aliases ?? [])].some(
          (text) => text !== undefined && nameKey(text) === wanted,
        ),
      )
      .map((r) => r.id),
  );
  const fromWork = new Set<string>();
  if (query.olWork && OL_WORK.test(query.olWork)) {
    const answer = SparqlAnswer.safeParse(
      await upstream.json(workSeriesUrl(query.olWork), {
        ttl: TTL.reference,
        headers: SPARQL_HEADERS,
      }),
    );
    for (const b of answer.success ? (answer.data.results.bindings as Binding[]) : []) {
      const id = entity(b, 'series');
      if (ENTITY.test(id)) fromWork.add(id);
    }
  }
  const ids = [...new Set([...fromWork, ...found.map((r) => r.id)])]
    .filter((id) => ENTITY.test(id))
    .slice(0, CANDIDATES + fromWork.size);
  if (ids.length === 0) return null;
  const parts = readParts(
    await Promise.all(
      partsUrls(ids, language).map((url) =>
        upstream.json(url, { ttl: TTL.reference, headers: SPARQL_HEADERS }),
      ),
    ),
  );
  const authors = splitAuthors(query.author);
  let best: { candidate: Candidate; score: number } | null = null;
  for (const id of ids) {
    const candidate = parts.get(id);
    if (!candidate || candidate.works.size === 0) continue;
    // The search matched a name in some language; the query's own names may say it too.
    const isNamed =
      named.has(id) || [...candidate.names.values()].some((n) => nameKey(n) === wanted);
    // A work can be in two series (Rincewind and Discworld): it only settles which one when it
    // is in one, or when the name says so too.
    const byWork = fromWork.has(id) && (isNamed || fromWork.size === 1);
    if (!isNamed && !byWork) continue;
    const works = [...candidate.works.values()];
    const by =
      authors.length > 0 ? works.filter((w) => writtenBy(w, authors)).length : works.length;
    if (authors.length > 0 && by === 0 && !byWork) continue;
    const score = by + (byWork ? 1000 : 0);
    if (!best || score > best.score) best = { candidate, score };
  }
  return best ? toSeriesList(best.candidate, language) : null;
}
