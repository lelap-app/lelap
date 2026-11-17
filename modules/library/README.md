# @lelap/library

Kotlin Expo module for the local library on Android.

- `pickFolder`: Android's folder picker; keeps a persisted read permission on the chosen folder.
- `listTree`: every file below the folder through the Storage Access Framework, with its volume
  path (`primary:Audiobooks/Book/01.mp3`) as a stable location. It rejects with
  `ERR_LELAP_PERMISSION` when the folder cannot be read, so a scan never mistakes a lost folder for
  an empty one.

- `findSilences`: chapters from silences (M45). `SilenceWorker` decodes the book's own files
  (MediaExtractor and MediaCodec) in WorkManager, only with enough battery, and keeps a checkpoint
  every minute of audio so a stopped scan goes on from there. `SilenceScanner` finds stretches
  under the threshold in 50 ms windows. `silenceStatuses` hands the silences to JavaScript, where
  `silenceChapters` in `@lelap/core` turns them into chapters.

The grouping into books and everything stored lives in `@lelap/core`.

Unit tests for the pure parts run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-library:testDebugUnitTest
```
