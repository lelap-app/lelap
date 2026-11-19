import type { ZodType } from 'zod';

import { PAGE_STYLE } from './config';
import { catalogPath, type Extra, metaPath, streamPath } from './paths';
import {
  Badges,
  type CatalogDefinition,
  CatalogResponse,
  type ContentType,
  Edition,
  HealthResponse,
  isConfigurable,
  LATEST_PROTOCOL_VERSION,
  Manifest,
  type Meta,
  MetaPreview,
  MetaResponse,
  MultiPartStream,
  needsConfiguration,
  offersHealth,
  prefixesFor,
  type ResourceName,
  SingleFileStream,
  supports,
} from './protocol';

/** What `checkAddon` needs from `fetch`; `globalThis.fetch` fits, and so does an add-on's own. */
export type CheckFetch = (url: string, init?: RequestInit) => Promise<Response> | Response;

export type CheckLevel = 'error' | 'warning';

/** What a problem is about, so CI output can be grouped and filtered. */
export type CheckKind =
  | 'manifest'
  | 'http'
  | 'cors'
  | 'speed'
  | 'caching'
  | 'health'
  | 'configure'
  | 'catalog'
  | 'paging'
  | 'meta'
  | 'ids'
  | 'stream'
  | 'audio'
  | 'scrobble';

export type CheckProblem = {
  /** `error`: the app refuses or loses something. `warning`: it works, worse than it could. */
  level: CheckLevel;
  kind: CheckKind;
  /** The address that answered. */
  url: string;
  /** The field in the answer, such as `metas[2].id`. */
  field?: string;
  message: string;
};

export type CheckReport = {
  /** The manifest's address. */
  url: string;
  addon: { id: string; name: string; version: string } | null;
  /** No errors. Warnings don't count. */
  ok: boolean;
  errors: number;
  warnings: number;
  requests: number;
  problems: CheckProblem[];
  /** What was skipped and why; never a problem. */
  notes: string[];
};

export type CheckOptions = {
  /** Defaults to `globalThis.fetch`. Pass `(url, init) => addon.fetch(new Request(url, init))` to check an add-on without a server. */
  fetch?: CheckFetch;
  /** Items per catalog whose meta and streams are checked. Default 2. */
  items?: number;
  /** Catalog pages followed through `skip`. Default 3. */
  pages?: number;
  /** The text for catalogs that need a `search`. Default `the`. */
  search?: string;
  /** More items to check meta and streams for, such as IDs no catalog lists. */
  ids?: { type: ContentType; id: string }[];
  /** Also ask for the first bytes of each checked stream's audio. Off by default. */
  audio?: boolean;
  /** Answers slower than this are a warning. Default 3000 ms. */
  slowMs?: number;
  /** The app gives up after 10 s; so does the check. */
  timeoutMs?: number;
  /** A ceiling, so a big add-on is never flooded. Default 150. */
  maxRequests?: number;
};

const APP_TIMEOUT_MS = 10_000;
const KNOWN_EXTRAS = new Set(['search', 'genre', 'skip']);
const FAR_SKIP = 100_000;
const UNKNOWN = 'lelap-check-unknown';

type Answer = {
  url: string;
  status: number;
  headers: Headers;
  text: string;
  /** The parsed body, or `undefined` when it isn't JSON. */
  body: unknown;
};

type Item = { type: ContentType; id: string; from: string };

/** Accepts what people paste: with or without `manifest.json`, `lelap://` or a trailing slash. */
export function manifestUrlOf(input: string): string | null {
  const text = input.trim().replace(/^lelap:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // No setters: React Native's URL, which bundles this module too, has none.
  const path = url.pathname.endsWith('/manifest.json')
    ? url.pathname
    : `${url.pathname.replace(/\/+$/, '')}/manifest.json`;
  return `${url.origin}${path}${url.search}`;
}

const formatField = (path: readonly PropertyKey[]): string =>
  path.reduce<string>(
    (out, key) =>
      typeof key === 'number' ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key),
    '',
  );

const valueAt = (root: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    root,
  );

const short = (value: unknown): string => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

type RawIssue = {
  code: string;
  path: PropertyKey[];
  message: string;
  expected?: string;
  errors?: RawIssue[][];
};

function describeIssue(issue: RawIssue, value: unknown): string {
  if (value === undefined && issue.code === 'invalid_type')
    return `Missing; expected ${issue.expected ?? 'a value'}.`;
  const message = issue.message.replace(/^Invalid (input|option|value): /, '').replace(/\.?$/, '.');
  const capital = message.charAt(0).toUpperCase() + message.slice(1);
  return issue.code === 'invalid_type' ? capital : `${capital} Got ${short(value)}.`;
}

function flatten(
  issues: RawIssue[],
  root: unknown,
  prefix: PropertyKey[],
): { field: string; message: string }[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    // A union's issues are those of each branch; the branch with the fewest is the one meant.
    if (issue.code === 'invalid_union' && issue.errors?.length) {
      const closest = issue.errors.reduce((a, b) => (b.length < a.length ? b : a));
      if (closest.length > 0) return flatten(closest, root, path);
    }
    return [{ field: formatField(path), message: describeIssue(issue, valueAt(root, path)) }];
  });
}

function issuesOf(
  schema: ZodType,
  value: unknown,
  prefix: PropertyKey[] = [],
): { field: string; message: string }[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return flatten(result.error.issues as unknown as RawIssue[], value, prefix);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Checks a web add-on against protocol v1: fetches its manifest and every resource it declares,
 * validates each answer with the SDK's schemas, and looks at what schemas can't see (CORS,
 * speed, caching, paging, IDs that come back, configure pages). Never throws for a broken add-on;
 * throws only for an address that isn't one.
 */
export async function checkAddon(input: string, options: CheckOptions = {}): Promise<CheckReport> {
  const manifestUrl = manifestUrlOf(input);
  if (!manifestUrl) throw new Error(`Not an add-on address: ${input}`);
  const base = manifestUrl.slice(0, -'manifest.json'.length);
  const fetcher: CheckFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const perCatalog = options.items ?? 2;
  const pages = Math.max(1, options.pages ?? 3);
  const search = options.search ?? 'the';
  const slowMs = options.slowMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? APP_TIMEOUT_MS;
  const maxRequests = options.maxRequests ?? 150;

  const problems: CheckProblem[] = [];
  const notes: string[] = [];
  let requests = 0;
  let stopped = false;

  const report = (
    level: CheckLevel,
    kind: CheckKind,
    url: string,
    message: string,
    field?: string,
  ) => {
    problems.push({ level, kind, url, ...(field ? { field } : {}), message });
  };
  const reportIssues = (
    kind: CheckKind,
    url: string,
    issues: { field: string; message: string }[],
    level: CheckLevel = 'error',
  ) => {
    // A broken list repeats one mistake per item; ten say enough.
    for (const issue of issues.slice(0, 10)) report(level, kind, url, issue.message, issue.field);
    if (issues.length > 10)
      report(level, kind, url, `${issues.length - 10} more problems like these.`);
  };

  async function get(
    path: string,
    kind: CheckKind,
    init: RequestInit = {},
    absolute = false,
  ): Promise<Answer | null> {
    if (requests >= maxRequests) {
      if (!stopped) notes.push(`Stopped after ${maxRequests} requests.`);
      stopped = true;
      return null;
    }
    requests += 1;
    const url = absolute ? path : new URL(path, base).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetcher(url, {
        ...init,
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(init.headers as Record<string, string>) },
      });
      const text = init.method === 'OPTIONS' ? '' : await response.text();
      const elapsed = Date.now() - started;
      if (elapsed > slowMs)
        report(
          'warning',
          'speed',
          url,
          `Took ${seconds(elapsed)}. The app waits ${seconds(APP_TIMEOUT_MS)}, and a listener notices well before.`,
        );
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      return { url, status: response.status, headers: response.headers, text, body };
    } catch (error) {
      const message = controller.signal.aborted
        ? `No answer within ${seconds(timeoutMs)}; the app gives up then.`
        : `Could not be reached: ${error instanceof Error ? error.message : String(error)}.`;
      report('error', kind === 'audio' ? 'audio' : 'http', url, message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** CORS and JSON for an answer the web app reads. */
  function inspectJson(answer: Answer, kind: CheckKind): boolean {
    const origin = answer.headers.get('access-control-allow-origin');
    if (!origin)
      report(
        'error',
        'cors',
        answer.url,
        'No Access-Control-Allow-Origin header: the web app cannot read this answer.',
      );
    else if (origin !== '*')
      report(
        'warning',
        'cors',
        answer.url,
        `Access-Control-Allow-Origin is ${origin}; web builds on other hosts, such as a self-hosted one, cannot read it. Send *.`,
      );
    if (answer.status !== 200) {
      report('error', kind, answer.url, `Answered ${answer.status}; expected 200.`);
      return false;
    }
    const type = answer.headers.get('content-type') ?? '';
    if (!/^application\/json\b/i.test(type))
      report(
        'warning',
        'http',
        answer.url,
        `Content-Type is ${type || 'missing'}; send application/json.`,
      );
    if (answer.body === undefined) {
      report('error', kind, answer.url, 'The answer is not JSON.');
      return false;
    }
    return true;
  }

  function inspectCaching(answer: Answer) {
    const header = answer.headers.get('cache-control') ?? '';
    const cacheMaxAge = isObject(answer.body) ? answer.body.cacheMaxAge : undefined;
    if (cacheMaxAge === undefined && !/max-age=\d+/.test(header))
      report(
        'warning',
        'caching',
        answer.url,
        'No cacheMaxAge and no Cache-Control max-age: the app and caches ask again every time.',
      );
  }

  // The manifest.
  const manifestAnswer = await get('manifest.json', 'manifest');
  const finish = (addon: CheckReport['addon']): CheckReport => {
    const merged = mergeRepeats(problems);
    const errors = merged.filter((p) => p.level === 'error').length;
    return {
      url: manifestUrl,
      addon,
      ok: errors === 0,
      errors,
      warnings: merged.length - errors,
      requests,
      problems: merged,
      notes,
    };
  };
  if (!manifestAnswer || !inspectJson(manifestAnswer, 'manifest')) return finish(null);
  const issues = issuesOf(Manifest, manifestAnswer.body);
  if (issues.length > 0) {
    reportIssues('manifest', manifestAnswer.url, issues);
    notes.push('Nothing else was checked: the app refuses this manifest.');
    return finish(null);
  }
  const manifest = Manifest.parse(manifestAnswer.body);
  const addon = { id: manifest.id, name: manifest.name, version: manifest.version };
  inspectCaching(manifestAnswer);

  if (manifest.sandbox) {
    notes.push(
      'This manifest is for an add-on inside the app, which runs as one JavaScript file on the phone. The check covers add-ons on a server.',
    );
    return finish(addon);
  }
  if ((manifest.protocolVersion ?? 1) > LATEST_PROTOCOL_VERSION)
    report(
      'warning',
      'manifest',
      manifestAnswer.url,
      `Revision ${manifest.protocolVersion} is newer than this SDK knows (${LATEST_PROTOCOL_VERSION}); update @lelap/sdk.`,
      'protocolVersion',
    );
  checkManifestSense(manifest, manifestAnswer.url, report);

  if (offersHealth(manifest)) {
    const answer = await get('health', 'health');
    if (answer && inspectJson(answer, 'health')) {
      const found = issuesOf(HealthResponse, answer.body);
      reportIssues('health', answer.url, found);
      if (found.length === 0 && isObject(answer.body) && answer.body.status !== 'ok')
        report(
          'warning',
          'health',
          answer.url,
          `Says ${String(answer.body.status)}${typeof answer.body.message === 'string' ? `: ${answer.body.message}` : ''}.`,
        );
    }
  }

  if (isConfigurable(manifest)) await checkConfigure();

  if (needsConfiguration(manifest)) {
    notes.push(
      'The add-on must be configured first, so its catalogs, meta and streams were not checked. Check the address its configure page hands out.',
    );
    await checkScrobble();
    return finish(addon);
  }

  const items: Item[] = [];
  const declares = (resource: ResourceName) =>
    manifest.resources.some((r) => (typeof r === 'string' ? r : r.name) === resource);

  if (declares('catalog')) {
    for (const catalog of manifest.catalogs) await checkCatalog(catalog);
    const answer = await get(
      catalogPath(manifest.catalogs[0]?.type ?? manifest.types[0] ?? 'audiobook', UNKNOWN),
      'catalog',
    );
    if (answer) expectNotFound(answer, 'catalog', 'a catalog it does not list');
  }

  for (const extra of options.ids ?? []) items.push({ ...extra, from: '' });

  let checkedMeta = 0;
  for (const item of items) {
    if (supports(manifest, 'meta', item.type, item.id)) {
      checkedMeta += 1;
      const meta = await checkMeta(item);
      const episode = meta?.episodes?.[0];
      if (episode && supports(manifest, 'stream', 'episode', episode.id))
        await checkStream({ type: 'episode', id: episode.id, from: `meta ${item.id}` });
    }
    if (supports(manifest, 'stream', item.type, item.id)) await checkStream(item);
  }
  if (declares('meta')) {
    if (checkedMeta === 0)
      notes.push('No item to check meta with: no catalog lists one this add-on answers for.');
    const type = items[0]?.type ?? manifest.types[0] ?? 'audiobook';
    const prefix =
      prefixesFor(manifest, 'meta')?.[0] ?? `${items[0]?.id.split(':')[0] ?? 'lelap'}:`;
    const answer = await get(metaPath(type, `${prefix}${UNKNOWN}`), 'meta');
    if (answer) expectNotFound(answer, 'meta', 'an ID it does not know');
  }
  if (declares('stream') && !items.some((i) => supports(manifest, 'stream', i.type, i.id)))
    notes.push('No item to check streams with; pass one with --id.');

  await checkScrobble();
  return finish(addon);

  function expectNotFound(answer: Answer, kind: CheckKind, what: string) {
    if (answer.status === 404) {
      if (!isObject(answer.body) || typeof answer.body.error !== 'string')
        report(
          'warning',
          kind,
          answer.url,
          'A 404 without a JSON body like {"error": "Not found"}.',
        );
      return;
    }
    if (answer.status >= 500)
      report('error', kind, answer.url, `Answered ${answer.status} for ${what}; expected 404.`);
    else if (answer.status === 200)
      report(
        'warning',
        kind,
        answer.url,
        `Answered 200 for ${what}; a 404 lets the app ask another add-on.`,
      );
  }

  async function checkCatalog(catalog: CatalogDefinition) {
    const extra: Extra = {};
    for (const wanted of catalog.extra ?? []) {
      if (!wanted.isRequired) continue;
      if (wanted.name === 'search') extra.search = search;
      else if (wanted.name === 'genre' && wanted.options?.[0]) extra.genre = wanted.options[0];
      else if (wanted.name !== 'skip') {
        notes.push(
          `Catalog ${catalog.type}/${catalog.id} was not checked: it needs “${wanted.name}”, which the check can't fill.`,
        );
        return;
      }
    }
    const pageOf = async (skip: number) => {
      const answer = await get(
        catalogPath(catalog.type, catalog.id, skip > 0 ? { ...extra, skip: String(skip) } : extra),
        'catalog',
      );
      if (!answer || !inspectJson(answer, 'catalog')) return null;
      reportIssues('catalog', answer.url, issuesOf(CatalogResponse, answer.body));
      const metas =
        isObject(answer.body) && Array.isArray(answer.body.metas) ? answer.body.metas : [];
      const valid = metas.flatMap((meta: unknown, index) => {
        const parsed = MetaPreview.safeParse(meta);
        if (!parsed.success) return [];
        if (isObject(meta) && meta.badges !== undefined)
          reportIssues(
            'catalog',
            answer.url,
            issuesOf(Badges, meta.badges, ['metas', index, 'badges']).map((issue) => ({
              ...issue,
              message: `${issue.message} The app drops these badges.`,
            })),
            'warning',
          );
        return [parsed.data];
      });
      inspectCaching(answer);
      return { answer, metas: valid, count: metas.length };
    };

    const first = await pageOf(0);
    if (!first) return;
    const where = first.answer.url;
    const ids = first.metas.map((m) => m.id);
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (repeated.length > 0)
      report(
        'warning',
        'catalog',
        where,
        `Lists ${[...new Set(repeated)].map(short).join(', ')} more than once.`,
      );
    const strangers = first.metas.filter((m) => m.type !== catalog.type);
    if (strangers.length > 0)
      report(
        'warning',
        'catalog',
        where,
        `A ${catalog.type} catalog lists items of type ${[...new Set(strangers.map((m) => m.type))].join(', ')}.`,
      );
    if (first.metas.length === 0) notes.push(`Catalog ${catalog.type}/${catalog.id} is empty.`);
    for (const meta of first.metas.slice(0, perCatalog))
      if (!items.some((i) => i.id === meta.id && i.type === meta.type))
        items.push({ type: meta.type, id: meta.id, from: where });

    if (!(catalog.extra ?? []).some((e) => e.name === 'skip') || first.count === 0) return;
    // Paging: each page brings new items, and it ends.
    const seen = new Set(ids);
    let skip = first.count;
    for (let page = 1; page < pages; page += 1) {
      const next = await pageOf(skip);
      if (!next || next.count === 0) break;
      const fresh = next.metas.filter((m) => !seen.has(m.id));
      if (next.metas.length > 0 && fresh.length === 0) {
        report(
          'warning',
          'paging',
          next.answer.url,
          `skip=${skip} brings only items earlier pages listed. skip counts items, so it should start after the first ${skip}, or answer an empty list past the end.`,
        );
        break;
      }
      for (const meta of next.metas) seen.add(meta.id);
      skip += next.count;
    }
    const far = await pageOf(FAR_SKIP);
    if (far && far.metas.length > 0 && far.metas.every((m) => seen.has(m.id)))
      report(
        'error',
        'paging',
        far.answer.url,
        `skip=${FAR_SKIP} still brings the first items; paging never ends. Answer an empty list past the end.`,
      );
  }

  async function checkMeta(item: Item): Promise<Meta | null> {
    const answer = await get(metaPath(item.type, item.id), 'meta');
    if (!answer) return null;
    if (answer.status === 404) {
      report(
        'error',
        'ids',
        answer.url,
        item.from
          ? `Not found, though ${item.from} lists ${item.id}. IDs must come back the way the add-on handed them out.`
          : `Not found: ${item.id}.`,
      );
      return null;
    }
    if (!inspectJson(answer, 'meta')) return null;
    const found = issuesOf(MetaResponse, answer.body);
    reportIssues('meta', answer.url, found);
    inspectCaching(answer);
    if (found.length > 0) return null;
    const raw = (answer.body as { meta: Record<string, unknown> }).meta;
    if (raw.badges !== undefined)
      reportIssues('meta', answer.url, issuesOf(Badges, raw.badges, ['meta', 'badges']), 'warning');
    if (Array.isArray(raw.editions))
      reportIssues(
        'meta',
        answer.url,
        raw.editions.flatMap((edition, index) =>
          issuesOf(Edition, edition, ['meta', 'editions', index]).map((issue) => ({
            ...issue,
            message: `${issue.message} The app drops every edition.`,
          })),
        ),
        'warning',
      );
    const meta = MetaResponse.parse(answer.body).meta;
    if (meta.id !== item.id)
      report(
        'error',
        'ids',
        answer.url,
        `Asked for ${item.id} and got ${meta.id}. The app keeps an item by the ID it asked for, so it must come back unchanged.`,
        'meta.id',
      );
    if (meta.type !== item.type)
      report(
        'warning',
        'meta',
        answer.url,
        `Asked for a ${item.type} and got a ${meta.type}.`,
        'meta.type',
      );
    return meta;
  }

  async function checkStream(item: Item) {
    const answer = await get(streamPath(item.type, item.id), 'stream');
    if (!answer || !inspectJson(answer, 'stream')) return;
    inspectCaching(answer);
    const body = answer.body;
    if (!isObject(body) || !Array.isArray(body.streams)) {
      report('error', 'stream', answer.url, 'Missing; expected an array.', 'streams');
      return;
    }
    if (body.cacheMaxAge !== undefined)
      reportIssues(
        'stream',
        answer.url,
        issuesOf(CatalogResponse.shape.cacheMaxAge, body.cacheMaxAge, ['cacheMaxAge']),
      );
    if (body.streams.length === 0) notes.push(`No streams for ${item.type} ${item.id}.`);
    const keys = new Set<string>();
    for (const [index, stream] of body.streams.entries()) {
      const field = ['streams', index];
      const schema = isObject(stream) && 'parts' in stream ? MultiPartStream : SingleFileStream;
      const found = issuesOf(schema, stream, field);
      reportIssues('stream', answer.url, found);
      if (!isObject(stream)) continue;
      if (stream.headers !== undefined)
        report(
          'error',
          'stream',
          answer.url,
          'Only add-ons inside the app may send headers; the app refuses this stream.',
          `${formatField(field)}.headers`,
        );
      if (typeof stream.sourceKey === 'string') {
        if (keys.has(stream.sourceKey))
          report(
            'error',
            'stream',
            answer.url,
            `Two streams share sourceKey ${short(stream.sourceKey)}; the app keeps places by it.`,
            `${formatField(field)}.sourceKey`,
          );
        keys.add(stream.sourceKey);
      }
      if (typeof stream.mime === 'string' && !isAudioType(stream.mime))
        report(
          'warning',
          'stream',
          answer.url,
          `${short(stream.mime)} is not an audio type.`,
          `${formatField(field)}.mime`,
        );
      const urls = Array.isArray(stream.parts)
        ? stream.parts.map((part, at) => ({
            url: isObject(part) ? part.url : undefined,
            field: `${formatField(field)}.parts[${at}].url`,
          }))
        : [{ url: stream.url, field: `${formatField(field)}.url` }];
      for (const { url, field: where } of urls) {
        if (typeof url !== 'string') continue;
        checkAudioAddress(url, answer.url, where);
      }
      const first = urls[0]?.url;
      if (options.audio && found.length === 0 && index === 0 && typeof first === 'string')
        await probeAudio(first);
    }
  }

  function checkAudioAddress(url: string, from: string, field: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.username || parsed.password)
      report(
        'error',
        'stream',
        from,
        'The address carries a login; anyone who sees the answer has it.',
        field,
      );
    if (parsed.protocol === 'http:')
      report(
        'warning',
        'stream',
        from,
        'Plain http: the web app, on https, cannot play it. Use https.',
        field,
      );
    if (parsed.host === new URL(base).host && parsed.pathname.startsWith(new URL(base).pathname))
      notes.push(
        `${url} is served by the add-on itself. Make sure it is audio you are allowed to share.`,
      );
  }

  async function probeAudio(url: string) {
    const answer = await get(
      url,
      'audio',
      { headers: { Range: 'bytes=0-1', Accept: '*/*' } },
      true,
    );
    if (!answer) return;
    if (answer.status !== 200 && answer.status !== 206) {
      report('error', 'audio', url, `Answered ${answer.status}; the app cannot play it.`);
      return;
    }
    const type = answer.headers.get('content-type') ?? '';
    if (type && !isAudioType(type) && !/^application\/octet-stream/i.test(type))
      report('warning', 'audio', url, `Content-Type is ${type}, not audio.`);
    if (answer.status === 200)
      report(
        'warning',
        'audio',
        url,
        'Ignores Range requests: the listener cannot seek before the whole file has loaded.',
      );
  }

  async function checkConfigure() {
    const answer = await get('configure', 'configure', { headers: { Accept: 'text/html' } });
    if (!answer) return;
    if (answer.status !== 200) {
      report('error', 'configure', answer.url, `Answered ${answer.status}; expected a page.`);
      return;
    }
    if (!/^text\/html\b/i.test(answer.headers.get('content-type') ?? ''))
      report('error', 'configure', answer.url, 'Not an HTML page.');
    if (!answer.text.includes(PAGE_STYLE))
      report(
        'warning',
        'configure',
        answer.url,
        'Does not use the shared page style: put PAGE_STYLE from @lelap/sdk in a <style> element, so the listener sees one style.',
      );
    if (answer.headers.get('referrer-policy') !== 'no-referrer')
      report(
        'warning',
        'configure',
        answer.url,
        'No Referrer-Policy: no-referrer. The page and its addresses can carry the listener’s settings.',
      );
  }

  async function checkScrobble() {
    if (!manifest.resources.some((r) => (typeof r === 'string' ? r : r.name) === 'scrobble'))
      return;
    // The app posts JSON, so a browser asks first; without an answer the web app can't scrobble.
    const answer = await get('scrobble', 'scrobble', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.org',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    if (!answer) return;
    const allowHeaders = answer.headers.get('access-control-allow-headers') ?? '';
    if (
      answer.status >= 300 ||
      !answer.headers.get('access-control-allow-origin') ||
      !/\*|content-type/i.test(allowHeaders)
    )
      report(
        'error',
        'scrobble',
        answer.url,
        `The preflight answered ${answer.status} without allowing a JSON POST: the web app cannot send events.`,
      );
  }
}

function isAudioType(type: string): boolean {
  return /^(audio\/|application\/(ogg|x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)\b)/i.test(type);
}

/** Checks a manifest that parses but contradicts itself. */
function checkManifestSense(
  manifest: Manifest,
  url: string,
  report: (
    level: CheckLevel,
    kind: CheckKind,
    url: string,
    message: string,
    field?: string,
  ) => void,
) {
  const names = manifest.resources.map((r) => (typeof r === 'string' ? r : r.name));
  if (names.includes('catalog') && manifest.catalogs.length === 0)
    report(
      'warning',
      'manifest',
      url,
      'Declares the catalog resource but no catalogs.',
      'catalogs',
    );
  if (!names.includes('catalog') && manifest.catalogs.length > 0)
    report('error', 'manifest', url, 'Lists catalogs but not the catalog resource.', 'resources');
  const keys = manifest.catalogs.map((c) => `${c.type}/${c.id}`);
  keys.forEach((key, index) => {
    if (keys.indexOf(key) !== index)
      report('error', 'manifest', url, `Two catalogs are ${key}.`, `catalogs[${index}]`);
  });
  manifest.catalogs.forEach((catalog, index) => {
    (catalog.extra ?? []).forEach((extra, at) => {
      const field = `catalogs[${index}].extra[${at}]`;
      if (extra.isRequired && !KNOWN_EXTRAS.has(extra.name))
        report(
          'warning',
          'manifest',
          url,
          `The app fills only search, genre and skip, so it never shows a catalog that needs “${extra.name}”.`,
          field,
        );
      if (extra.name === 'genre' && extra.isRequired && !extra.options?.length)
        report('warning', 'manifest', url, 'A required genre needs options to choose from.', field);
    });
  });
  for (const type of manifest.types) {
    const anyResource = names.some((name) => {
      const definition = manifest.resources.find(
        (r) => (typeof r === 'string' ? r : r.name) === name,
      );
      return (
        typeof definition === 'string' || !definition?.types || definition.types.includes(type)
      );
    });
    if (!anyResource)
      report('warning', 'manifest', url, `Lists type ${type}, but no resource takes it.`, 'types');
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The report as text, one problem per paragraph: level, kind, address, then field and message. */
export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(
    report.addon
      ? `${report.addon.name} ${report.addon.version} (${report.addon.id})`
      : 'Add-on check',
    report.url,
    '',
  );
  for (const problem of report.problems) {
    lines.push(`${problem.level.padEnd(8)}${problem.kind}  ${problem.url}`);
    lines.push(`        ${problem.field ? `${problem.field}: ` : ''}${problem.message}`);
  }
  if (report.notes.length > 0) {
    if (report.problems.length > 0) lines.push('');
    for (const note of report.notes) lines.push(`note    ${note}`);
  }
  if (report.problems.length > 0 || report.notes.length > 0) lines.push('');
  lines.push(
    `${report.ok ? 'Passed' : 'Failed'}: ${plural(report.errors, 'error')}, ${plural(report.warnings, 'warning')}, ${plural(report.requests, 'request')}.`,
  );
  return `${lines.join('\n')}\n`;
}

/** One problem that every answer shares, such as missing CORS, is said once. */
function mergeRepeats(problems: CheckProblem[]): CheckProblem[] {
  const groups = new Map<string, { problem: CheckProblem; more: number }>();
  for (const problem of problems) {
    const key = `${problem.level}|${problem.kind}|${problem.field ?? ''}|${problem.message}`;
    const group = groups.get(key);
    if (group) group.more += 1;
    else groups.set(key, { problem, more: 0 });
  }
  return [...groups.values()].map(({ problem, more }) =>
    more === 0
      ? problem
      : {
          ...problem,
          message: `${problem.message} The same at ${more} more ${more === 1 ? 'address' : 'addresses'}.`,
        },
  );
}
