const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('sql');
// Babel inlines each migration's .sql into drizzle/migrations.js, and Metro caches that file by its
// own text, so an edit to an existing .sql would never reach the app. Keying the whole cache on the
// migrations' contents rebuilds after such an edit; restart Metro to pick it up.
const migrations = path.join(__dirname, '../../packages/core/drizzle');
const migrationsHash = crypto.createHash('sha256');
for (const name of fs
  .readdirSync(migrations)
  .filter((n) => n.endsWith('.sql'))
  .sort()) {
  migrationsHash.update(name).update(fs.readFileSync(path.join(migrations, name)));
}
config.cacheVersion = `${config.cacheVersion ?? ''}:${migrationsHash.digest('hex').slice(0, 16)}`;
// sql.js's WebAssembly, for the web build's database.
config.resolver.assetExts.push('wasm');

// Metro does not drop unused exports, so zod's `locales` export would bring all 50 languages into
// both bundles. Only English is used; the shim keeps the export with that one.
const zodLocales = path.join(__dirname, 'metro/zod-locales.js');
// The same for `fromJSONSchema`, which nothing in the app calls (M126).
const zodFromJsonSchema = path.join(__dirname, 'metro/zod-from-json-schema.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === '../locales/index.js' &&
    /[\\/]zod[\\/]v4[\\/](core|classic)[\\/]/.test(context.originModulePath)
  ) {
    return { type: 'sourceFile', filePath: zodLocales };
  }
  if (
    moduleName === './from-json-schema.js' &&
    /[\\/]zod[\\/]v4[\\/]classic[\\/]external\.js$/.test(context.originModulePath)
  ) {
    return { type: 'sourceFile', filePath: zodFromJsonSchema };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
