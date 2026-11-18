// Over-the-air JavaScript updates (M18), on top of app.json. Hosts come from the environment like
// `src/config.ts`. Updates switch on only when a code-signing certificate is present, so builds
// without one (forks, local checkouts) never load code from the network. See docs/milestones/m18.md.
const { existsSync } = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const domain = process.env.EXPO_PUBLIC_LELAP_DOMAIN || 'lelap.app';
  const base = (process.env.EXPO_PUBLIC_LELAP_UPDATES || `https://updates.${domain}`).replace(
    /\/$/,
    '',
  );
  // Relative to this folder either way: Expo joins the path onto the project root.
  const certificate = path.relative(
    __dirname,
    path.resolve(__dirname, process.env.LELAP_UPDATES_CERTIFICATE || 'certs/certificate.pem'),
  );
  // The F-Droid build gets its updates from F-Droid, never over the air.
  const fdroid = process.env.EXPO_PUBLIC_LELAP_DISTRIBUTION === 'fdroid';
  const signed = !fdroid && existsSync(path.resolve(__dirname, certificate));
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      './plugins/withReproducibleBuild',
      './plugins/withArchitectures',
      './plugins/withPackaging',
    ],
    // A new native build gets a new runtime; JavaScript-only releases reach older APKs of it.
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      enabled: signed,
      url: `${base}/manifest`,
      // The app checks itself (src/ota.ts), so the setting in Settings → Updates can turn it off.
      checkAutomatically: 'NEVER',
      fallbackToCacheTimeout: 0,
      // Declared here so the app may switch it to `beta` at run time; the same in every build,
      // so stable and beta APKs of one native build share a runtime version.
      requestHeaders: { 'expo-channel-name': 'production' },
      ...(signed
        ? {
            codeSigningCertificate: certificate,
            codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
          }
        : {}),
    },
  };
};
