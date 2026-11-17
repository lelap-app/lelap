# M17 follow-ups

Checks that need a phone, a car (or Google's Desktop Head Unit) or a deployed web app. The code,
the Kotlin unit tests for the browse tree and `assembleDebug` pass; none of this has run on a device.

## Android Auto

- [ ] With "Unknown sources" on in Android Auto's developer settings, Lelap appears among the media
      apps (DHU or a car).
- [ ] The root shows four tabs: Continue listening, On this phone, Podcasts, Up Next.
- [ ] With the app swiped away (and after a reboot, app not opened since), the lists still load.
- [ ] Picking a book plays it from its saved place, with smart rewind; picking the book that is
      already loaded keeps its live place.
- [ ] Picking an episode, then letting it end, hands over to the next Up Next item.
- [ ] Playing book A in the car, then book B, then opening the app: A's place is the one reached
      in the car (folded from the service's earlier-places list), and B's too.
- [ ] Changing the library in the app (download a book, subscribe) updates the open car lists
      without reconnecting (`notifyChildrenChanged`).
- [ ] Covers: http(s) covers show in the car; local covers (`file://`) are left out on purpose,
      since Android Auto can't open the app's files. If that looks too bare, add a
      `ContentProvider` for covers.
- [ ] Streamed books whose links are signed (S3) still play from the car hours after the app last
      wrote the snapshot; if not, re-sign in the service or drop those books from the car lists.

## Offline web

- [ ] On `listen.`, after one visit, DevTools → Network → Offline, reload: the app starts and
      shows the library.
- [ ] Deploy a new build: the open tab keeps the old version, the new worker shows as "waiting";
      after closing every tab and opening the app again the new version runs and the old
      `lelap-shell-*` cache is gone.
- [ ] Streaming and downloading audio work with the worker in place, and no audio shows up in
      Application → Cache Storage.
- [ ] Discover shows the last catalog answers when offline.
- [ ] The Docker image (Caddy) serves `sw.js` with `Cache-Control: no-cache` and the app starts
      offline there too.
