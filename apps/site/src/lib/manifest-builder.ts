// The manifest builder's logic, kept free of the DOM and of zod so the page ships a few kilobytes.
// `test/manifest-builder.test.ts` checks `checkManifest` against the SDK's schema.

export const CONTENT_TYPES = ['audiobook', 'podcast', 'episode'] as const;
export const RESOURCES = ['catalog', 'meta', 'stream'] as const;
export const EXTRAS = ['search', 'genre', 'skip'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];
export type ResourceName = (typeof RESOURCES)[number];
export type ExtraName = (typeof EXTRAS)[number];

export type ExtraDraft = { name: ExtraName; isRequired: boolean; options: string[] };
export type CatalogDraft = { type: string; id: string; name: string; extras: ExtraDraft[] };
export type ResourceDraft = {
  name: ResourceName;
  /** Narrows the manifest's types for this resource; empty for all of them. */
  types: string[];
  /** Replaces the manifest's prefixes for this resource; empty to use them. */
  idPrefixes: string[];
};

export type Draft = {
  id: string;
  version: string;
  name: string;
  description: string;
  logo: string;
  configurable: boolean;
  types: string[];
  resources: ResourceDraft[];
  idPrefixes: string[];
  catalogs: CatalogDraft[];
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type Issue = { level: 'error' | 'warning'; field: string; message: string };

/** Splits a list typed with commas, spaces or new lines. */
export function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** The manifest the draft describes, in the protocol's field order, without empty optionals. */
export function buildManifest(draft: Draft): JsonObject {
  const manifest: JsonObject = {
    id: draft.id.trim(),
    version: draft.version.trim(),
    protocol: 1,
    name: draft.name.trim(),
    description: draft.description.trim(),
  };
  if (draft.logo.trim()) manifest.logo = draft.logo.trim();
  manifest.types = [...draft.types];
  manifest.resources = draft.resources.map((resource) => {
    if (resource.types.length === 0 && resource.idPrefixes.length === 0) return resource.name;
    const definition: JsonObject = { name: resource.name };
    if (resource.types.length > 0) definition.types = [...resource.types];
    if (resource.idPrefixes.length > 0) definition.idPrefixes = [...resource.idPrefixes];
    return definition;
  });
  if (draft.idPrefixes.length > 0) manifest.idPrefixes = [...draft.idPrefixes];
  manifest.catalogs = draft.catalogs.map((catalog) => {
    const definition: JsonObject = {
      type: catalog.type,
      id: catalog.id.trim(),
      name: catalog.name.trim(),
    };
    if (catalog.extras.length > 0)
      definition.extra = catalog.extras.map((extra) => {
        const out: JsonObject = { name: extra.name };
        if (extra.isRequired) out.isRequired = true;
        if (extra.options.length > 0) out.options = [...extra.options];
        return out;
      });
    return definition;
  });
  if (draft.configurable) manifest.configurable = true;
  return manifest;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isType = (value: unknown): boolean => (CONTENT_TYPES as readonly unknown[]).includes(value);
const isResource = (value: unknown): value is ResourceName =>
  (RESOURCES as readonly unknown[]).includes(value);

function isHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * The protocol's rules for a manifest, as errors: what `Manifest.parse` in `@lelap/sdk` rejects.
 * Takes any JSON so it can also check a manifest pasted from elsewhere.
 */
export function checkManifest(manifest: unknown): Issue[] {
  const issues: Issue[] = [];
  const error = (field: string, message: string) => issues.push({ level: 'error', field, message });
  if (!isObject(manifest)) {
    error('manifest', 'A manifest is a JSON object.');
    return issues;
  }
  const m = manifest;

  if (!isString(m.id) || m.id.length < 3) error('id', 'The ID needs at least 3 characters.');
  if (!isString(m.version) || !/^\d+\.\d+\.\d+/.test(m.version))
    error('version', 'The version is a semantic version, such as 1.0.0.');
  if (m.protocol !== 1) error('protocol', 'The protocol is 1.');
  if (!isString(m.name) || m.name.length === 0) error('name', 'The name can’t be empty.');
  if (!isString(m.description))
    error('description', 'The description is a string; it may be empty.');
  if (m.logo !== undefined && (!isString(m.logo) || !isHttpUrl(m.logo)))
    error('logo', 'The logo is an http or https URL.');

  if (!Array.isArray(m.types) || m.types.length === 0) error('types', 'Pick at least one type.');
  else if (!m.types.every(isType)) error('types', 'Types are audiobook, podcast and episode.');

  if (!Array.isArray(m.resources) || m.resources.length === 0)
    error('resources', 'Pick at least one resource.');
  else
    m.resources.forEach((resource, index) => {
      const field = `resources[${index}]`;
      if (isResource(resource)) return;
      if (!isObject(resource) || !isResource(resource.name)) {
        error(field, 'A resource is catalog, meta or stream, as a name or an object.');
        return;
      }
      if (
        resource.types !== undefined &&
        !(Array.isArray(resource.types) && resource.types.every(isType))
      )
        error(`${field}.types`, 'Types are audiobook, podcast and episode.');
      if (resource.idPrefixes !== undefined && !isPrefixList(resource.idPrefixes))
        error(`${field}.idPrefixes`, 'ID prefixes can’t be empty.');
    });

  if (m.idPrefixes !== undefined && !isPrefixList(m.idPrefixes))
    error('idPrefixes', 'ID prefixes can’t be empty.');

  if (!Array.isArray(m.catalogs)) error('catalogs', 'Catalogs are a list; use [] for none.');
  else
    m.catalogs.forEach((catalog, index) => {
      const field = `catalogs[${index}]`;
      if (!isObject(catalog)) {
        error(field, 'A catalog is an object.');
        return;
      }
      if (!isType(catalog.type)) error(`${field}.type`, 'Pick the catalog’s type.');
      if (!isString(catalog.id) || catalog.id.length === 0)
        error(`${field}.id`, 'The catalog needs an ID.');
      if (!isString(catalog.name) || catalog.name.length === 0)
        error(`${field}.name`, 'The catalog needs a name.');
      if (catalog.extra === undefined) return;
      if (!Array.isArray(catalog.extra)) {
        error(`${field}.extra`, 'Extras are a list.');
        return;
      }
      catalog.extra.forEach((extra, e) => {
        const at = `${field}.extra[${e}]`;
        if (!isObject(extra) || !isString(extra.name) || extra.name.length === 0)
          error(at, 'An extra needs a name.');
        else if (extra.isRequired !== undefined && typeof extra.isRequired !== 'boolean')
          error(`${at}.isRequired`, 'isRequired is true or false.');
        else if (
          extra.options !== undefined &&
          !(Array.isArray(extra.options) && extra.options.every(isString))
        )
          error(`${at}.options`, 'Options are a list of strings.');
      });
    });

  if (m.configurable !== undefined && typeof m.configurable !== 'boolean')
    error('configurable', 'configurable is true or false.');
  return issues;
}

const isPrefixList = (value: unknown) =>
  Array.isArray(value) && value.every((prefix) => isString(prefix) && prefix.length > 0);

/** Things the protocol allows but that would not work the way the author likely means. */
export function adviseManifest(manifest: JsonObject): Issue[] {
  const issues: Issue[] = [];
  const warn = (field: string, message: string) =>
    issues.push({ level: 'warning', field, message });
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter(isString) : [];
  const types = strings(manifest.types);
  const resources = (Array.isArray(manifest.resources) ? manifest.resources : []).map((resource) =>
    isString(resource)
      ? { name: resource, types, idPrefixes: strings(manifest.idPrefixes) }
      : isObject(resource)
        ? {
            name: String(resource.name),
            types: resource.types ? strings(resource.types) : types,
            idPrefixes: resource.idPrefixes
              ? strings(resource.idPrefixes)
              : strings(manifest.idPrefixes),
          }
        : null,
  );
  const resource = (name: ResourceName) => resources.find((r) => r?.name === name);
  const catalogs = (
    Array.isArray(manifest.catalogs) ? (manifest.catalogs as unknown[]) : []
  ).filter(isObject);

  if (
    isString(manifest.id) &&
    manifest.id.length >= 3 &&
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(manifest.id)
  )
    warn('id', 'Use reverse DNS of a domain you control, such as org.example.readings.');

  const allPrefixes = [
    ...strings(manifest.idPrefixes),
    ...resources.flatMap((r) => r?.idPrefixes ?? []),
  ];
  for (const prefix of new Set(allPrefixes)) {
    if (!/^[a-z][a-z0-9_-]*:$/.test(prefix))
      warn(
        'idPrefixes',
        `“${prefix}” should look like example: (lowercase, ending in a colon); the app compares the start of each ID.`,
      );
  }

  for (const name of ['meta', 'stream'] as const) {
    const r = resource(name);
    if (r && r.idPrefixes.length === 0)
      warn(
        'idPrefixes',
        `Without ID prefixes, the app asks this add-on for the ${name} of every item a listener opens.`,
      );
  }
  const streams = resource('stream');
  if (streams && streams.types.includes('podcast') && !streams.types.includes('episode'))
    warn(
      'types',
      'Podcast episodes are streamed with the type episode. Add episode to stream podcasts.',
    );

  const catalogResource = resource('catalog');
  if (catalogResource && catalogs.length === 0)
    warn('catalogs', 'The catalog resource is on, but there are no catalogs.');
  if (!catalogResource && catalogs.length > 0)
    warn(
      'resources',
      'There are catalogs, but the catalog resource is off; the app won’t ask for them.',
    );

  const seen = new Set<string>();
  catalogs.forEach((catalog, index) => {
    const field = `catalogs[${index}]`;
    const key = `${String(catalog.type)}/${String(catalog.id)}`;
    if (seen.has(key))
      warn(field, `Two ${String(catalog.type)} catalogs share the ID “${String(catalog.id)}”.`);
    seen.add(key);
    if (catalogResource && isString(catalog.type) && !catalogResource.types.includes(catalog.type))
      warn(
        field,
        `This catalog’s type, ${catalog.type}, isn’t among the catalog resource’s types.`,
      );
    const extras = Array.isArray(catalog.extra) ? catalog.extra.filter(isObject) : [];
    for (const extra of extras) {
      if (extra.name === 'genre' && strings(extra.options).length === 0)
        warn(field, 'A genre extra needs options for the app to show as filters.');
      if (extra.isRequired === true && extra.name !== 'search')
        warn(field, `With ${String(extra.name)} required, this catalog never shows on Home.`);
    }
  });
  return issues;
}

/** `src/addon.ts` for the template in `services/template`, with this manifest and stub handlers. */
export function starterCode(manifest: JsonObject): string {
  const has = (name: ResourceName) =>
    Array.isArray(manifest.resources) &&
    manifest.resources.some((r) => r === name || (isObject(r) && r.name === name));
  const handlers: string[] = [];
  if (has('catalog'))
    handlers.push(`  // Answer { metas: MetaPreview[] }; extra has search, genre and skip as strings.
  catalog: async ({ type, id, extra }) => {
    return { metas: [], cacheMaxAge: 3600 };
  },`);
  if (has('meta'))
    handlers.push(`  // Answer { meta: Meta }, or null for an ID you don't know (a 404).
  meta: async ({ type, id }) => {
    return null;
  },`);
  if (has('stream'))
    handlers.push(`  // Answer { streams: Stream[] }; an empty list when you have nothing.
  stream: async ({ type, id }) => {
    return { streams: [] };
  },`);
  return `import { createAddon, type Manifest } from '@lelap/sdk';

export const manifest: Manifest = ${JSON.stringify(manifest, null, 2)};

export const addon = createAddon({
  manifest,
${handlers.join('\n\n')}
});
`;
}
