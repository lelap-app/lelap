// Release builds for the CPUs phones and tablets have. x86 and x86_64 are for emulators and a few
// Chromebooks; leaving them out halves native build time and APK size. `expo run:android` passes
// the connected device's CPU on the command line, which wins, so emulators still get dev builds.
const { withGradleProperties } = require('expo/config-plugins');

const ARCHITECTURES = 'arm64-v8a,armeabi-v7a';

module.exports = function withArchitectures(config) {
  return withGradleProperties(config, (mod) => {
    const rest = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures'),
    );
    mod.modResults = [
      ...rest,
      { type: 'property', key: 'reactNativeArchitectures', value: ARCHITECTURES },
    ];
    return mod;
  });
};
