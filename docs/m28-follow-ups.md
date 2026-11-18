# M28 follow-ups

Built and checked on a Mac: the F-Droid prebuild removes `REQUEST_INSTALL_PACKAGES`; two clean
release builds of the F-Droid APK are byte-identical and contain no local paths; the release
dependency tree has no Google Play services or Firebase. Before the fixes, two things differed or
leaked: absolute source paths in the app's own native libraries, and the random ID and build time
expo-updates writes into `assets/app.manifest`.

Left to do:

- **First tagged release with two APKs.** Check that `lelap-<version>-fdroid.apk`, `SHA256SUMS`
  and both attestations appear on the GitHub release, and that the F-Droid APK installs over the
  direct one (and back) without uninstalling.
- **Reproducibility across machines.** Run `scripts/verify-fdroid-apk.sh v<version>` on a Linux
  machine (F-Droid's build server is Debian) against the release's F-Droid APK. Native code built
  for the app and by library modules maps its source paths to fixed prefixes
  (`plugins/withReproducibleBuild.js`; library modules since M54, which found their build IDs
  differing between folders); native code that comes prebuilt (React Native, Hermes, Expo modules from Maven) is the same bytes
  everywhere. If the check fails, `apksigcopier compare` names the differing files; `diffoscope`
  shows why.
- **Submit to F-Droid** after 1.0: fill `AllowedAPKSigningKeys` in
  [`fdroid/app.lelap.yml`](fdroid/app.lelap.yml) from `apksigner verify --print-certs`, open a
  merge request on fdroiddata, and answer the reviewers. Expect questions about the npm
  dependencies (they are built from source by Metro and Hermes during the build).
- **Screenshots** for the listing: `fastlane/metadata/android/en-US/images/phoneScreenshots/`.
- **Changelogs:** add `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` with each
  release (500 characters at most).
