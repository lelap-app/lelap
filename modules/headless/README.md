# @lelap/headless

What the app needs to do while none of its screens is up (M123), on Android.

- **Add-ons without the screen.** The app's add-on sandbox is a hidden WebView inside its screen
  (`apps/app/src/sandbox`). When the app runs without one, such as in the background refresh or a
  server task, `openSandbox` starts the same page in a WebView of its own that is never shown:
  the same settings (no file or content access, no storage, no cache, no new windows, only
  `about:` addresses), and no network of its own. Messages go both ways as with
  react-native-webview, so the page and the app's side (`sandbox/index.ts`) are the same; the
  add-on still only reaches the network by asking the app, which fetches with the same native
  fetch and the same host rules.
- **Server tasks.** `ServerTasks.request(context, kind, bookId)` asks WorkManager, with a network,
  to run the app's JavaScript task registered with `registerServerTask`, starting the app
  without a screen if it isn't running. The playback service asks for `places` after a pause of
  a book whose server keeps places, and for `locate` after it started a book from an add-on
  server that locates files (Up Next, Android Auto, the widget, resuming from headphones). Other
  modules depend on this one (`implementation project(':lelap-headless')`).

Unit tests for the pure part run on the JVM:

```sh
cd apps/app/android && ./gradlew :lelap-headless:testDebugUnitTest
```
