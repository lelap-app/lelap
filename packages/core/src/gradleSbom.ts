// The Gradle libraries inside the APK as CycloneDX components (M104), read from the text of
// `gradle :app:dependencies --configuration releaseRuntimeClasspath`. The release adds them to
// the SBOM pnpm writes for the npm packages. No dependencies: the release job runs it without
// installing anything.

export type MavenComponent = {
  type: 'library';
  'bom-ref': string;
  group: string;
  name: string;
  version: string;
  purl: string;
};

/**
 * Every resolved Maven library in a dependency tree, once each, sorted. Lines for the project's
 * own modules (`project :x`), constraints (`(c)`) and unresolved entries (`(n)`) are skipped; a
 * version that Gradle raised (`1.0 -> 1.2`) counts as the one it chose.
 */
export function gradleComponents(tree: string): MavenComponent[] {
  const found = new Map<string, MavenComponent>();
  for (const raw of tree.split('\n')) {
    const line = /^[| ]*[+\\]--- (.+)$/.exec(raw.trimEnd())?.[1];
    if (!line) continue;
    if (line.startsWith('project ') || /\((c|n)\)$/.test(line)) continue;
    const entry = line.replace(/\s+\(\*\)$/, '');
    const [declared = '', chosen] = entry.split(/\s+->\s+/);
    if (chosen?.startsWith('project ')) continue;
    // A substituted module (`a:b:+ -> c:d:1.0`) is the one Gradle put in its place.
    const substituted = chosen !== undefined && chosen.split(':').length === 3;
    const [group, name, requested] = (substituted ? chosen : declared).split(':');
    const version = ((substituted ? requested : chosen) ?? requested ?? '')
      .replace(/^\{strictly\s+|\}$/g, '')
      .trim();
    if (!group || !name || !version || /\s/.test(version)) continue;
    const purl = `pkg:maven/${group}/${name}@${version}`;
    found.set(purl, { type: 'library', 'bom-ref': purl, group, name, version, purl });
  }
  return [...found.values()].sort((a, b) => a.purl.localeCompare(b.purl));
}

type Bom = { bomFormat?: unknown; components?: unknown[] };

/** The SBOM with the Maven components added after its own, skipping any already listed. */
export function addComponents<T extends Bom>(bom: T, extra: MavenComponent[]): T {
  const components = bom.components ?? [];
  const refs = new Set(
    components.map((c) => (c as { 'bom-ref'?: unknown })['bom-ref']).filter(Boolean),
  );
  const added = extra.filter((c) => !refs.has(c['bom-ref']) && refs.add(c['bom-ref']));
  return { ...bom, components: [...components, ...added] };
}
