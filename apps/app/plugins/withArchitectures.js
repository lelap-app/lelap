// Release builds for the CPUs phones and tablets have. x86 and x86_64 are for emulators and a few
// Chromebooks; leaving them out halves native build time and APK size. `expo run:android` passes
// the connected device's CPU on the command line, which wins, so emulators still get dev builds.
//
// Releases build one APK per CPU type (`-PreactNativeArchitectures=arm64-v8a`), each with its own
// versionCode: app.json's code times ten plus a digit for the CPU, the scheme of
// `abiVersionCode` in packages/core/src/release.ts. Builds for several CPUs end in 0.
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const ARCHITECTURES = 'arm64-v8a,armeabi-v7a';

// Must match ABI_DIGIT in packages/core/src/release.ts; the release workflow checks each APK.
const DIGITS = "['armeabi-v7a': 1, 'arm64-v8a': 2]";

const MARKER = 'lelap: versionCode per CPU type';

module.exports = function withArchitectures(config) {
  config = withGradleProperties(config, (mod) => {
    const rest = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures'),
    );
    mod.modResults = [
      ...rest,
      { type: 'property', key: 'reactNativeArchitectures', value: ARCHITECTURES },
    ];
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    const gradle = mod.modResults.contents;
    if (gradle.includes(MARKER)) return mod;
    // The app's build.gradle has one versionCode line, in defaultConfig.
    const replaced = gradle.replace(
      /^([ \t]*)versionCode\s+(\d+)[ \t]*$/m,
      (_, indent, code) =>
        `${indent}// ${MARKER} (plugins/withArchitectures.js)\n${indent}versionCode ${code} * 10 + (${DIGITS}[findProperty('reactNativeArchitectures')] ?: 0)`,
    );
    if (replaced === gradle) throw new Error('withArchitectures: no versionCode in defaultConfig');
    mod.modResults.contents = replaced;
    return mod;
  });
};
