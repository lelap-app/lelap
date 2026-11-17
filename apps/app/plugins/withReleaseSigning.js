// Signs release builds with the keystore the release workflow decodes from a secret. Without the
// environment variables (local builds, forks) release builds keep Expo's debug signing, and with
// LELAP_UNSIGNED=1 they stay unsigned: F-Droid's build server compares an unsigned build with our
// signed APK.
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
    signingConfigs {
        lelapRelease {
            if (System.getenv('LELAP_KEYSTORE_PATH')) {
                storeFile file(System.getenv('LELAP_KEYSTORE_PATH'))
                storePassword System.getenv('LELAP_KEYSTORE_PASSWORD')
                keyAlias System.getenv('LELAP_KEY_ALIAS')
                keyPassword System.getenv('LELAP_KEY_PASSWORD')
            }
        }
    }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (!gradle.includes('lelapRelease')) {
      gradle = gradle.replace(/android\s*\{/, (open) => `${open}${SIGNING}`);
      gradle = gradle.replace(
        /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/,
        "$1signingConfig System.getenv('LELAP_KEYSTORE_PATH') ? signingConfigs.lelapRelease : (System.getenv('LELAP_UNSIGNED') ? null : signingConfigs.debug)",
      );
    }
    mod.modResults.contents = gradle;
    return mod;
  });
};
