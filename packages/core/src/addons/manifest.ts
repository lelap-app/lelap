import { Manifest, RESOURCES } from '@lelap/sdk';

const known = new Set<string>(RESOURCES);

/** A resource entry's name when it has one, in either the string or the object form. */
function resourceName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null) {
    const name = (entry as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return null;
}

/**
 * Reads an add-on manifest, leaving out resources this app doesn't know yet, so a later protocol
 * revision can add one to an existing add-on without older apps refusing it. Entries without a
 * name stay in and still fail.
 */
export function readManifest(
  value: unknown,
): { success: true; data: Manifest } | { success: false } {
  let input = value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const resources = (value as { resources?: unknown }).resources;
    if (Array.isArray(resources)) {
      input = {
        ...value,
        resources: resources.filter((entry) => {
          const name = resourceName(entry);
          return name === null || known.has(name);
        }),
      };
    }
  }
  const parsed = Manifest.safeParse(input);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}
