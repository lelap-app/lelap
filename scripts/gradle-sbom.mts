// Adds the Gradle libraries inside the APK to the release's SBOM, run with Node's type stripping:
//   node scripts/gradle-sbom.mts DEPENDENCIES.txt SBOM.json
// DEPENDENCIES.txt is the output of `gradlew :app:dependencies --configuration
// releaseRuntimeClasspath`; SBOM.json is pnpm's CycloneDX file, rewritten in place.
import { readFileSync, writeFileSync } from 'node:fs';

import { addComponents, gradleComponents } from '../packages/core/src/gradleSbom.ts';

const [tree, sbom] = process.argv.slice(2);
if (!tree || !sbom) {
  console.error('usage: node scripts/gradle-sbom.mts DEPENDENCIES.txt SBOM.json');
  process.exit(1);
}

const libraries = gradleComponents(readFileSync(tree, 'utf8'));
// An empty list means Gradle's output changed shape; better a failed release than a thin SBOM.
if (libraries.length === 0) {
  console.error(`No Gradle libraries found in ${tree}.`);
  process.exit(1);
}
const bom = JSON.parse(readFileSync(sbom, 'utf8')) as { components?: unknown[] };
writeFileSync(sbom, `${JSON.stringify(addComponents(bom, libraries), null, 2)}\n`);
console.log(`${libraries.length} Gradle libraries added.`);
