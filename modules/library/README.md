# @lelap/library

Kotlin Expo module for the local library on Android.

- `pickFolder`: Android's folder picker; keeps a persisted read permission on the chosen folder.
- `listTree`: every file below the folder through the Storage Access Framework, with its volume
  path (`primary:Audiobooks/Book/01.mp3`) as a stable location. It rejects with
  `ERR_LELAP_PERMISSION` when the folder cannot be read, so a scan never mistakes a lost folder for
  an empty one.

The grouping into books and everything stored lives in `@lelap/core`.

Unit tests for the pure parts run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-library:testDebugUnitTest
```
