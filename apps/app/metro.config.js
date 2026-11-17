const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('sql');
// sql.js's WebAssembly, for the web build's database.
config.resolver.assetExts.push('wasm');

// Metro does not drop unused exports, so zod's `locales` export would bring all 50 languages into
// both bundles. Only English is used; the shim keeps the export with that one.
const zodLocales = path.join(__dirname, 'metro/zod-locales.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === '../locales/index.js' &&
    /[\\/]zod[\\/]v4[\\/](core|classic)[\\/]/.test(context.originModulePath)
  ) {
    return { type: 'sourceFile', filePath: zodLocales };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
