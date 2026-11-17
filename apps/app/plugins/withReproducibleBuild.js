// Settings the F-Droid listing needs, in every build so the direct APK and the F-Droid APK come
// from the same Gradle setup:
// - no dependency metadata block: it is encrypted with a Google key, which F-Droid's scanner
//   rejects and nobody else can read;
// - native code built for the app (React Native's codegen and app modules) and by every library
//   module with C++ (Reanimated, Screens, Expo modules) records source paths relative to the
//   repository and Gradle's cache, not this machine's folders, so a build in another folder gives
//   the same bytes. Without it the libraries' build IDs differ between folders (M54);
// - with EXPO_PUBLIC_LELAP_DISTRIBUTION=fdroid, no REQUEST_INSTALL_PACKAGES: that build never
//   installs updates itself (see src/config.ts). Its embedded update manifest, which expo-updates
//   stamps with a random ID and the build time, gets an ID from its contents and the time of the
//   release commit (or SOURCE_DATE_EPOCH), so two builds of one commit are the same bytes.
const {
  withAndroidManifest,
  withAppBuildGradle,
  withProjectBuildGradle,
} = require('expo/config-plugins');

const MARKER = '// lelap: reproducible build';

// Compiler flags that turn the repository, Gradle's cache and the NDK into fixed prefixes. On
// macOS /tmp and /var are links into /private, and compilers see either spelling, so both are
// mapped. The build folder CMake compiles in is named after a hash of absolute paths
// (.cxx/RelWithDebInfo/<hash>), so the debug info names "." as that folder instead.
const maps = (
  indent,
) => `def ndk = { try { android.ndkDirectory.canonicalPath } catch (ignored) { null } }()
${indent}def maps = [
${indent}    (rootProject.projectDir.parentFile.parentFile.parentFile.canonicalPath): '/lelap',
${indent}    (gradle.gradleUserHomeDir.canonicalPath): '/gradle',
${indent}    (ndk): '/ndk',
${indent}].findAll { path, to -> path }.collectMany { path, to ->
${indent}    (path.startsWith('/private/') ? [path, path.substring(8)] : [path]).collect { "-ffile-prefix-map=\${it}=\${to}" }
${indent}} + ['-ffile-compilation-dir=.']`;

// After each library module's own build.gradle, before Android's plugin reads it.
const LIBRARY_PATHS = `
// lelap: reproducible native libraries (plugins/withReproducibleBuild.js)
def lelapMapPaths = { sub ->
    def android = sub.extensions.findByName('android')
    if (sub.plugins.hasPlugin('com.android.library') && android != null) {
        ${maps('        ')}
        android.defaultConfig.externalNativeBuild.cmake.cFlags(*maps)
        android.defaultConfig.externalNativeBuild.cmake.cppFlags(*maps)
    }
}
// React Native's root plugin has some projects evaluated before this runs.
subprojects { sub ->
    if (sub.state.executed) lelapMapPaths(sub) else sub.afterEvaluate { lelapMapPaths(sub) }
}
`;

const FIXED_MANIFEST = `
// lelap: fixed embedded update manifest for the F-Droid build (plugins/withReproducibleBuild.js)
tasks.configureEach { task ->
    if (task.name ==~ /create.*ReleaseUpdatesResources/) {
        task.doLast {
            def file = new File(task.assetDir.get().asFile, 'app.manifest')
            if (!file.exists()) return
            def manifest = new groovy.json.JsonSlurper().parse(file)
            manifest.remove('id')
            manifest.remove('commitTime')
            def body = groovy.json.JsonOutput.toJson(manifest)
            def epoch = System.getenv('SOURCE_DATE_EPOCH') ?:
                ['git', 'log', '-1', '--format=%ct'].execute(null, rootDir).text.trim()
            manifest.id = UUID.nameUUIDFromBytes(body.getBytes('UTF-8')).toString()
            manifest.commitTime = (epoch as long) * 1000
            file.text = groovy.json.JsonOutput.toJson(manifest)
        }
    }
}
`;

module.exports = function withReproducibleBuild(config) {
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(MARKER)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (open) => `${open}
        externalNativeBuild {
            cmake {
                ${maps('                ')}
                cFlags(*maps)
                cppFlags(*maps)
            }
        }`,
      );
      mod.modResults.contents = mod.modResults.contents.replace(
        /android\s*\{/,
        (open) => `${open}
    ${MARKER}
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }`,
      );
    }
    return mod;
  });
  config = withProjectBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('reproducible native libraries')) {
      mod.modResults.contents += LIBRARY_PATHS;
    }
    return mod;
  });
  if (process.env.EXPO_PUBLIC_LELAP_DISTRIBUTION === 'fdroid') {
    config = withAppBuildGradle(config, (mod) => {
      if (!mod.modResults.contents.includes('fixed embedded update manifest')) {
        mod.modResults.contents += FIXED_MANIFEST;
      }
      return mod;
    });
    config = withAndroidManifest(config, (mod) => {
      const manifest = mod.modResults.manifest;
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
      const permissions = (manifest['uses-permission'] ??= []);
      const name = 'android.permission.REQUEST_INSTALL_PACKAGES';
      const found = permissions.find((p) => p.$['android:name'] === name);
      if (found) found.$['tools:node'] = 'remove';
      else permissions.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
      return mod;
    });
  }
  return config;
};
