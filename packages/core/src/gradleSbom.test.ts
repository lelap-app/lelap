import { describe, expect, it } from 'vitest';

import { addComponents, gradleComponents } from './gradleSbom';

const TREE = String.raw`
> Task :app:dependencies

------------------------------------------------------------
Project ':app'
------------------------------------------------------------

releaseRuntimeClasspath - Runtime classpath of /release.
+--- com.facebook.react:react-android -> 0.88.1
|    +--- androidx.appcompat:appcompat:1.7.0
|    |    \--- androidx.annotation:annotation:1.8.1 -> 1.9.1
|    +--- com.facebook.react:hermes-android -> com.facebook.hermes:hermes-android:250829098.0.1
|    \--- com.squareup.okhttp3:okhttp:4.9.2
+--- com.facebook.react:react-native:+ -> com.facebook.react:react-android:0.88.1 (*)
+--- project :lelap-netfs
|    +--- com.hierynomus:smbj:0.15.0
|    +--- com.squareup.okhttp3:okhttp:4.9.2 (*)
|    \--- project :lelap-text
+--- org.jetbrains.kotlin:kotlin-stdlib:{strictly 2.1.0} -> 2.1.0 (c)
+--- org.example:pinned:{strictly 1.2}
\--- androidx.media3:media3-common:1.11.1 (n)

(*) - Indicates repeated occurrences of a transitive dependency subtree.
`;

describe('the Gradle libraries for the SBOM', () => {
  it('lists each resolved library once, as Gradle chose it', () => {
    expect(gradleComponents(TREE).map((c) => c.purl)).toEqual([
      'pkg:maven/androidx.annotation/annotation@1.9.1',
      'pkg:maven/androidx.appcompat/appcompat@1.7.0',
      'pkg:maven/com.facebook.hermes/hermes-android@250829098.0.1',
      'pkg:maven/com.facebook.react/react-android@0.88.1',
      'pkg:maven/com.hierynomus/smbj@0.15.0',
      'pkg:maven/com.squareup.okhttp3/okhttp@4.9.2',
      'pkg:maven/org.example/pinned@1.2',
    ]);
    expect(gradleComponents(TREE)[0]).toEqual({
      type: 'library',
      'bom-ref': 'pkg:maven/androidx.annotation/annotation@1.9.1',
      group: 'androidx.annotation',
      name: 'annotation',
      version: '1.9.1',
      purl: 'pkg:maven/androidx.annotation/annotation@1.9.1',
    });
  });

  it('adds them after the npm packages, without doubles', () => {
    const bom = { bomFormat: 'CycloneDX', components: [{ 'bom-ref': 'pkg:npm/zod@4.0.0' }] };
    const extra = gradleComponents('+--- a.b:c:1.0\n\\--- a.b:c:1.0');
    const merged = addComponents(bom, [...extra, ...extra]);
    expect(merged.bomFormat).toBe('CycloneDX');
    expect(merged.components.map((c) => (c as { 'bom-ref': string })['bom-ref'])).toEqual([
      'pkg:npm/zod@4.0.0',
      'pkg:maven/a.b/c@1.0',
    ]);
  });
});
