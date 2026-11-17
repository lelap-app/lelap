// Android backups (cloud and device-to-device) keep the library, places and settings, but never
// the key that opens the sealed secrets (expo-secure-store's preferences) or WorkManager's
// database, which holds the WebDAV login of queued downloads (WorkManager already keeps it in
// no_backup; the rule covers older layouts). Restored on a new phone, Lelap asks
// to pair sync and enter server passwords again. expo-secure-store's own rules are off: they back
// up only shared preferences and would leave the database out.
const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const EXCLUDES = [
  // Android's docs name preferences files with `.xml`; expo-secure-store's own rules without.
  '<exclude domain="sharedpref" path="SecureStore.xml"/>',
  '<exclude domain="sharedpref" path="SecureStore"/>',
  '<exclude domain="database" path="androidx.work.workdb"/>',
  '<exclude domain="database" path="androidx.work.workdb-wal"/>',
  '<exclude domain="database" path="androidx.work.workdb-shm"/>',
];

const lines = (indent) => EXCLUDES.map((line) => `${indent}${line}`).join('\n');

const FILES = {
  'lelap_backup_rules.xml': `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 11 and lower. Written by plugins/withBackupRules.js. -->
<full-backup-content>
${lines('  ')}
</full-backup-content>
`,
  'lelap_data_extraction_rules.xml': `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12 and higher. Written by plugins/withBackupRules.js. -->
<data-extraction-rules>
  <cloud-backup>
${lines('    ')}
  </cloud-backup>
  <device-transfer>
${lines('    ')}
  </device-transfer>
</data-extraction-rules>
`,
};

module.exports = function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(FILES))
        fs.writeFileSync(path.join(dir, name), text);
      return mod;
    },
  ]);
  return withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app.$['android:fullBackupContent'] = '@xml/lelap_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/lelap_data_extraction_rules';
    return mod;
  });
};
