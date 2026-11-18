// Bouncy Castle's three jars (modules/netfs, for SMB and SFTP) carry the same licence file and an
// OSGi manifest each; the APK keeps one licence and no manifest, or the release build stops on
// the duplicates.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// lelap: duplicate jar files (plugins/withPackaging.js)';

const RESOURCES = `
        ${MARKER}
        resources {
            pickFirsts += ['META-INF/LICENSE.md']
            excludes += ['META-INF/versions/9/OSGI-INF/MANIFEST.MF']
        }`;

module.exports = function withPackaging(config) {
  return withAppBuildGradle(config, (mod) => {
    const gradle = mod.modResults.contents;
    if (gradle.includes(MARKER)) return mod;
    const replaced = gradle.replace(/packagingOptions\s*\{/, (open) => `${open}${RESOURCES}`);
    if (replaced === gradle) throw new Error('withPackaging: no packagingOptions block');
    mod.modResults.contents = replaced;
    return mod;
  });
};
