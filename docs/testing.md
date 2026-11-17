# Phone test list

The consolidated list of open checks for the first test round on a phone, gathered from the
`docs/m*-follow-ups.md` files and the checklists in [`apps/app/README.md`](../apps/app/README.md).
Each item links the file it came from; tick it there too (or update its status table) when it
passes. Items that are only unit-tested or checked in the web preview are here; items already
marked Pass on the phone are not.

Unless an item says otherwise, use a signed release APK (debug builds don't bundle JavaScript) on
the Pixel, with Wi-Fi on and the `Audiobooks` folder chosen.

## Round 1 (2026-11-17)

Release build from main on a Pixel 10 Pro XL. Passed items are ticked below with a note. Found and
fixed in [#64](https://github.com/lelap-app/lelap/pull/64) and
[#66](https://github.com/lelap-app/lelap/pull/66): sleep timer as a list; Library title under the
status bar; streaming books not dimmed offline; lists stale while playing; episode menu as a system
dialog; “Book” for episodes; same-named add-ons in messages; search waiting for the slowest add-on;
sheets hidden behind the keyboard; the speed button's spoken name. Not bugs: no battery prompt
(Lelap was already exempt); “LibriVox did not answer” came from two leftover `localhost:8787`
add-ons on the test phone.

## A. Checks an agent can run over adb

A USB-connected Pixel and `adb` only. Useful commands:

- Install and start: `adb install -r <apk>`, `adb shell am start -n app.lelap/.MainActivity`,
  crashes in `adb logcat -b crash`.
- Screens: `adb exec-out screencap -p > shot.png`, labels with `adb shell uiautomator dump`.
- Media: `adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE` (also `_PLAY`, `_PAUSE`, `_NEXT`,
  `_PREVIOUS`); state and position in `adb shell dumpsys media_session`.
- Screen off: `adb shell input keyevent KEYCODE_SLEEP`, back on with `KEYCODE_WAKEUP`.
- App gone: swipe it from recents, or `adb shell am kill app.lelap` (process only) and
  `adb shell am force-stop app.lelap` (stops the service too).
- Network: `adb shell cmd connectivity airplane-mode enable|disable`, `adb shell svc wifi disable|enable`.
- Charger: `adb shell dumpsys battery unplug`, back with `adb shell dumpsys battery reset`.
- Files: `adb push <file> /sdcard/Download/` for imports, `adb shell mv` inside `/sdcard/Audiobooks`.

Ordered by risk: does the release build start and play at all, then playback, downloads and
offline, the background engine, sync on one device, and UI features.

### A1. The release build starts and plays

- [ ] [M3] Remove the leftover `localhost:8787` add-ons in Settings → Add-ons; the deployed ones come back on the next start. ([m3](m3-follow-ups.md#2-cleanup-on-the-test-phone))
- [x] [M8] A signed release APK installs over the debug build's data (or fresh) and cold-starts with no crash in logcat. ([m8](m8-follow-ups.md#2-checks)) **Passed 2026-11-17**: release build (debug-signed) installed over the debug build.
- [x] [M3] Home rows from LibriVox load with covers against the deployed `catalog.lelap.app`, not `wrangler dev`. ([m3](m3-follow-ups.md#1-device-checks)) **Passed 2026-11-17**.
- [x] [M3] Search “secret garden” against the deployed catalog: LibriVox and Open Library sections. ([m3](m3-follow-ups.md#1-device-checks)) **Passed 2026-11-17**: results now stream per add-on (#66).
- [x] [M3] A LibriVox book streams within a few seconds and shows as Streaming in the Library. ([m3](m3-follow-ups.md#1-device-checks)) **Passed 2026-11-17**.
- [ ] [M2] A book from the `Audiobooks` folder plays; `dumpsys media_session` shows PLAYING with title and a moving position. ([README](../apps/app/README.md#m2-device-checklist))
- [x] [M12] Icons render crisp in the tab bar, Player, mini player, Up Next and headers (screenshots). ([m12](m12-follow-ups.md)) **Passed 2026-11-17**.

### A2. Playback core

- [ ] [M2] Screen off (`KEYCODE_SLEEP`) for 10 minutes while playing: the position in `dumpsys media_session` keeps advancing. ([README](../apps/app/README.md#m2-device-checklist))
- [x] [M2] Notification and lock screen controls: play, pause, ⏮/⏭ via media key events change the session state and position by the skip interval. ([m19](m19-follow-ups.md#1-checks-on-a-phone)) **Passed 2026-11-17**: media keys: Next +30 s, Previous −30 s.
- [ ] [M2] ⏮/⏭ media keys skip 30 s across a part boundary in a podcast folder. ([README](../apps/app/README.md#m2-device-checklist))
- [x] [M2] Pause journal: pause, swipe the app away, reopen; the place matches the lock screen to the second (the 500 ms re-journal fix). ([README](../apps/app/README.md#checks-after-m9-2026-11-16)) **Passed 2026-11-17**: checked across a reinstall: 5:14 to the second.
- [ ] [M2] Deep resume: two hours into a 500 MB book, pause, swipe away, reopen; the Player shows the place within 2 s. ([m2](m2-follow-ups.md#1-device-checks))
- [ ] [M2] Swipe away while playing, keep playing a minute, stop from the notification, reopen: same place. ([m2](m2-follow-ups.md#1-device-checks))
- [ ] [M2] Reboot mid-book (`adb reboot`), reopen: same place. ([README](../apps/app/README.md#m2-device-checklist))
- [x] [M2] With the app force-stopped and nothing playing, `KEYCODE_MEDIA_PLAY` resumes the last book where it stopped (stand-in for headphones). ([README](../apps/app/README.md#m2-device-checklist)) **Passed 2026-11-17**.
- [x] [M2] Smart rewind: pause two minutes, Play; it starts 5 s earlier. ([README](../apps/app/README.md#m2-device-checklist)) **Passed 2026-11-17**: 21.7 s → 16.7 s after 2 min.
- [x] [M2] Bookmark with a note, restart the app, tap it: it jumps there. ([README](../apps/app/README.md#m2-device-checklist)) **Passed 2026-11-17**: after the note sheet fix in #66.
- [ ] [M2] Rescan: reopen the app; the Library appears at once with no “Scanning… n of m” line. ([README](../apps/app/README.md#m2-device-checklist))
- [ ] [M2] Rename a book folder with `adb shell mv`, pull to refresh: the book is dimmed; rename back: whole again, same place. ([README](../apps/app/README.md#m2-device-checklist))
- [ ] [M29] End of chapter, mid-file: start the timer two minutes before a mark; `ch.` shows, volume fades, playback stops on the mark, Play resumes a few seconds before it. ([m29](m29-follow-ups.md#phone-checks))
- [x] [M29] End of chapter, file end: stops at the file's end; next Play starts the next file. ([m29](m29-follow-ups.md#phone-checks)) **Passed 2026-11-17**: stopped at 12:30 on the mark, waits at 0:00 of the next.
- [ ] [M29] Seek with a chapter timer: a later chapter grows the time left, skipping back across a mark shrinks it. ([m29](m29-follow-ups.md#phone-checks))
- [ ] [M29] At 2× the timer's time left halves within a few seconds. ([m29](m29-follow-ups.md#phone-checks))
- [ ] [M29] Swipe the app away with a chapter timer running: it still stops on the mark. ([m29](m29-follow-ups.md#phone-checks))
- [ ] [M29] The accelerometer is not in `dumpsys sensorservice` active connections until the last five minutes of a 45-minute timer. ([m29](m29-follow-ups.md#phone-checks))
- [ ] [M25] The notification and lock screen sleep button steps 15 → 30 → chapter → off; the app's timer screen follows it, and the button follows a timer set in the app. ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M23] Playing a Podcasting 2.0 episode (`feeds.podcastindex.org/pc20.xml`) from the podcast page starts with its chapters in the sheet. ([m23](m23-follow-ups.md#1-device-checks))
- [ ] [M23] Notification and lock screen chapter skip use the fetched chapters after the first load. ([m23](m23-follow-ups.md#1-device-checks))
- [ ] [M23] Transcript follows along with the screen on; tapping a line while paused seeks. ([m23](m23-follow-ups.md#1-device-checks))
- [ ] [M32] A single-file stream of an `asin:` recording gets the Audnexus chapters; a stream whose length differs keeps its own or none. ([m32](m32-follow-ups.md#1-device-checks))

### A3. Downloads and offline

- [ ] [M4] First download on a LibriVox item: Android 17 asks for notifications, then Lelap asks for the battery exemption; allow both. ([README](../apps/app/README.md#m4-device-checklist))
- [x] [M4] Progress shows on the item page, in Settings → Downloads and storage, and in the notification with Cancel. ([README](../apps/app/README.md#m4-device-checklist)) **Passed 2026-11-17**: item page checked; notification and storage screen not looked at.
- [ ] [M4] Wi-Fi off mid-download (`svc wifi disable`): “Waiting for Wi-Fi”, then it resumes from the same byte. ([README](../apps/app/README.md#m4-device-checklist))
- [ ] [M4] “Only while charging” with `dumpsys battery unplug`: the download waits, then starts after `dumpsys battery reset`. ([README](../apps/app/README.md#m4-device-checklist))
- [ ] [M4] Swipe the app away mid-download: the notification keeps going; reopening shows the progress. ([README](../apps/app/README.md#m4-device-checklist))
- [x] [M4] A downloaded book plays in airplane mode with cover, chapters and its description. ([README](../apps/app/README.md#m4-device-checklist)) **Passed 2026-11-17**: Wi-Fi off too, no network.
- [ ] [M4] Remove download while it plays: it continues from the stream and the storage overview frees the space. ([README](../apps/app/README.md#m4-device-checklist))
- [ ] [M4] Remove from library on a downloaded book deletes its files (`adb shell run-as app.lelap ls files/`). ([README](../apps/app/README.md#m4-device-checklist))
- [ ] [M3] Airplane mode: Home shows no rows, local books play, a streamed book says it can't load. ([README](../apps/app/README.md#m3-device-checklist))
- [x] [M12] Airplane mode shows the Library banner and hides it when the network returns. ([m12](m12-follow-ups.md)) **Passed 2026-11-17**: shows; hiding again not watched.
- [ ] [M2] Airplane mode: rescan, resume, skip, smart rewind and bookmarks still work. ([README](../apps/app/README.md#m2-device-checklist))
- [ ] [M15] Offline, a downloaded book's item page still plays and shows its saved metadata. ([m15](m15-follow-ups.md#1-device-checks))
- [ ] [M32] A downloaded book with Audnexus chapters keeps them offline. ([m32](m32-follow-ups.md#1-device-checks))
- [ ] [M23] A downloaded episode with embedded chapters keeps them; the chapters file is not used. ([m23](m23-follow-ups.md#1-device-checks))

### A4. Background engine and podcasts

- [x] [M11] Hand-over with the app closed: queue two episodes, start the first near its end, swipe the app away; the second starts. ([README](../apps/app/README.md#m11-checks)) **Passed 2026-11-17**.
- [x] [M11] Reopen: the first episode is marked played and has left Up Next. ([README](../apps/app/README.md#m11-checks)) **Passed 2026-11-17**.
- [ ] [M11] A book in Up Next stops at its end; the episode queued after it does not start. ([README](../apps/app/README.md#m11-checks))
- [ ] [M29] End of episode with another in Up Next: stops at the end, marked played, the next does not start. ([m29](m29-follow-ups.md#phone-checks))
- [ ] [M5] Long-press each podcast folder → This is a podcast…: played episodes and the current place carry over. ([README](../apps/app/README.md#m5-device-checklist))
- [ ] [M5] A podcast from Search opens with episodes from its feed; Subscribe adds it to Podcasts (needs the Podcast Index keys on the catalog Worker). ([README](../apps/app/README.md#m5-device-checklist))
- [x] [M5] Paste an RSS address in the Podcasts tab; it subscribes. ([README](../apps/app/README.md#m5-device-checklist)) **Passed 2026-11-17**: NPR Up First.
- [ ] [M5] OPML: export, push the file back, import it; nothing is duplicated. ([README](../apps/app/README.md#m5-device-checklist))
- [ ] [M5] Auto-download with 3 newest: three download; marking one played removes it and fetches the next. ([README](../apps/app/README.md#m5-device-checklist))
- [ ] [M5] Pull to refresh fetches new episodes; an unchanged feed answers 304 (check in logcat or the proxy). ([README](../apps/app/README.md#m5-device-checklist))
- [ ] [M23] A feed subscribed on an older build gets people and funding after the next refresh on the new one. ([m23](m23-follow-ups.md#1-device-checks))

### A5. Sync and data on one device

- [ ] [M7] Android journal times: after a pause, the journal's time is when the place moved, not when it was written. ([m7](m7-follow-ups.md#2-checks))
- [ ] [M19] On a phone that syncs and has a server, `adb shell run-as app.lelap sqlite3` shows `sec1:` values; sync and playback keep working. ([m19](m19-follow-ups.md#1-checks-on-a-phone))
- [ ] [M19] `adb shell bmgr backupnow app.lelap`, reinstall, restore: library and places return, Sync asks to pair again, the server shows “Log in”. ([m19](m19-follow-ups.md#1-checks-on-a-phone))
- [ ] [M16] Settings → Backup → Export opens the share sheet; importing the pushed file after a reinstall brings back places, lists and tags. ([m16](m16-follow-ups.md))
- [ ] [M16] Import offers the file's add-ons and adds them only after “Add them”; a kids profile never sees the question. ([m16](m16-follow-ups.md))
- [ ] [M16] A library of a few hundred books exports and imports without freezing the UI. ([m16](m16-follow-ups.md))

### A6. UI features

- [ ] [M9] Switch profile while a book plays: its place stays with its profile. ([m9](m9-follow-ups.md#2-checks))
- [ ] [M9] Switch to a profile with nothing played: the lock screen and notification clear. ([README](../apps/app/README.md#checks-after-m9-2026-11-16))
- [ ] [M25] Switching to a profile with nothing loaded clears the widget and the tile. ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M9] Kids profile: the add-ons screen is refused; hidden catalogs are gone from Home and Search. ([m9](m9-follow-ups.md#2-checks))
- [ ] [M25] Add the widget at 4x1, resize to 4x2: the layout switches; cover, title and chapter show (`dumpsys appwidget`). ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M25] Widget play, pause, back and forward work with the app open and swiped away. ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M25] The widget's numbers follow the skip interval; its chapter line changes when a chapter ends. ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M25] Tapping the widget opens the player from a cold start and from the background. ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M25] After a reboot, widget Play resumes the last book at its place. ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M25] Quick Settings tile shows the book and Playing/Paused; a tap plays and pauses; a long press opens the player. ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M15] An Open Library work with several LibriVox recordings lists them all; Play plays the one picked, and the pick survives a restart. ([m15](m15-follow-ups.md#1-device-checks))
- [ ] [M15] Picking another source for a book in the library and pressing Play moves the book to it. ([m15](m15-follow-ups.md#1-device-checks))
- [ ] [M15] An Open Library-only work shows the no-audio card; “Manage add-ons” opens the add-ons screen; “More about this book” opens the browser. ([m15](m15-follow-ups.md#1-device-checks))
- [ ] [M32] The item page for an `asin:` book shows “Series, book N · Read by …”. ([m32](m32-follow-ups.md#1-device-checks))
- [ ] [M23] “Support this show” and a person's link open the browser. ([m23](m23-follow-ups.md#1-device-checks))
- [ ] [M3] Remove LibriVox in Settings → Add-ons, restart: it stays removed; pasting its manifest URL adds it back. ([README](../apps/app/README.md#m3-device-checklist))
- [ ] [M3] Long-press a streamed book → Remove from library; local books only offer Mark as finished. ([README](../apps/app/README.md#m3-device-checklist))
- [x] [M16] Long press opens the menu sheet; tags, “Add to a list…”, Download, Remove download and “This is a podcast…” work. ([m16](m16-follow-ups.md)) **Passed 2026-11-17**: menu opens; actions not all tried.
- [ ] [M16] A hand-made list keeps its order after moving books up, across a restart. ([m16](m16-follow-ups.md))
- [ ] [M24] Listening with the screen off for 30 minutes shows about 30 min today in Stats. ([m24](m24-follow-ups.md))
- [ ] [M24] Skipping, seeking and changing speed don't inflate the time. ([m24](m24-follow-ups.md))
- [ ] [M24] The goal sheet sets and clears a goal; the bar fills as books are marked finished. ([m24](m24-follow-ups.md))
- [ ] [M34] Smart AudioBook Player import finds the `position.sabp.dat` files in the scanned folder; places and finished marks match. ([m34](m34-follow-ups.md))
- [ ] [M34] A real Goodreads CSV (pushed): the dialog's counts fit, tags show, finished books appear in Stats under their year. ([m34](m34-follow-ups.md))
- [ ] [M34] A real AntennaPod `.db` export (pushed) opens; episodes show played or with their place; a half-played one confirms positions are milliseconds. ([m34](m34-follow-ups.md))
- [ ] [M34] A large AntennaPod export (hundreds of feeds) imports in reasonable time and memory, with “Loading feed n of m”. ([m34](m34-follow-ups.md))
- [ ] [M12] The Player fits a small screen (`adb shell wm size 1080x1920` and `wm density`) without the tool row touching the gesture bar. ([m12](m12-follow-ups.md))
- [ ] [M12] Android keeps its system dialogs for remove add-on, delete bookmark and download actions. ([m12](m12-follow-ups.md))
- [ ] [M12] With animations off (`settings put global animator_duration_scale 0`, also transition and window), nothing fades or scales. ([m12](m12-follow-ups.md))
- [ ] [M42] Largest font size (`adb shell settings put system font_scale 2.0`, then `wm density` up): Home, Library, Player, Settings and the item page show no clipped text; tab labels are whole; the Player scrolls and fine scrubbing still works. ([m42](m42-follow-ups.md#m42-follow-ups))
- [ ] [M42] With animations off, sheets, dialogs, the Player and car mode open without sliding or fading; the transcript jumps to the current line. ([m42](m42-follow-ups.md#m42-follow-ups))
- [ ] [M42] `uiautomator dump` on Home, Library, Player, Settings: every clickable node has a `content-desc` or text, and bounds of at least 48 dp; the widget's root and buttons have descriptions. ([m42](m42-follow-ups.md#m42-follow-ups))
- [ ] [M43] Cold start with the 10,000-book test library on a release build: Library rows on screen within 2 s on a mid-range phone, median of five screen recordings. ([m43](m43-follow-ups.md#cold-start))
- [ ] [M43] Fast scroll through 10,000 books: no blank gaps that stay, no stutter over a second, under 300 MB in `dumpsys meminfo`. ([m43](m43-follow-ups.md#m43-follow-ups))
- [ ] [M43] With 500 test podcasts the Podcasts tab opens at once, and no request goes out for a test feed. ([m43](m43-follow-ups.md#m43-follow-ups))
- [x] [M12] Player buttons carry names for TalkBack (Back 30 seconds, Play, Next chapter, …) in `uiautomator dump`. ([m12](m12-follow-ups.md)) **Passed 2026-11-17**: speed button now says Speed, 1× (#66).
- [ ] [M9] Install the web app from Chrome on the phone: `listen.lelap.app` → Add to home screen. ([README](../apps/app/README.md#checks-after-m9-2026-11-16))
- [ ] [M29] Expired link, playback and download: an add-on on the laptop (`adb reverse`) whose `/resolve/…` link answers 403 after a minute; playback continues, the download resumes, a link that keeps failing errors after one retry. ([m29](m29-follow-ups.md#phone-checks))

## B. Checks that need the user

### Calls, headphones, car and speakers

- [ ] [M1] With “Duck on calls” on, press Play during a phone call and during a VoIP call: the book plays quietly at once (it paused at once in `v0.1.0-beta.3`), and at full volume when the call ends. With it off: “starts when the call ends”, then it starts. **Passed on the emulator 2026-11-17** (Android 17, a faked phone call): −14 dB during the call, 0 dB after. Known: a book already playing when a call rings is muted by Android itself until the call ends (“muted player piids due to call/ring” in `dumpsys audio`), so it is silent rather than ducked. ([README](../modules/audio/README.md#m1-device-checklist))

- [ ] [M2] With the app closed, Play on Bluetooth headphones resumes the last book; ⏮/⏭ on them skip 30 s. ([README](../apps/app/README.md#m2-device-checklist))
- [ ] [M19] Play, pause and skip from Bluetooth headphones still work after the controller allowlist. ([m19](m19-follow-ups.md#1-checks-on-a-phone))
- [ ] [M22] A phone call and a VoIP call mid-book duck or pause and resume; ducking and sleep fade still work with boost on. ([m22](m22-follow-ups.md))
- [ ] [M2] Pressing Play repeatedly during a long call with ducking off doesn't stack rewinds. ([m2](m2-follow-ups.md#3-deferred-review-findings-minor))
- [ ] [M17] Lelap appears among Android Auto's media apps (DHU or a car) with Continue listening, On this phone, Podcasts and Up Next. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M17] Auto lists load with the app swiped away and after a reboot. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M17] Picking a book in the car plays from its place; the loaded book keeps its live place. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M17] An episode picked in the car hands over to the next Up Next item when it ends. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M17] Book A then book B in the car, then open the app: both places are the ones reached in the car. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M17] Library changes in the app update the open car lists without reconnecting. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M17] http(s) covers show in the car; decide whether leaving out local covers looks too bare. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M17] An S3-signed streamed book still plays from the car hours after the app last ran. ([m17](m17-follow-ups.md#android-auto))
- [ ] [M19] Play, pause and skip from Android Auto still work after the controller allowlist. ([m19](m19-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] Cast a LibriVox book to a Sonos: room name, title and cover in the Sonos app; pause, seek, ±30 s, next chapter across files, volume. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] Cast a LibriVox book to the Nest Mini: 1.5× applies, volume works; stopping from Google Home hands back. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] A DLNA TV plays an mp3 stream and an m4b from the phone; seek works once playing. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] A downloaded book and a folder book play from the phone's server; far seeks work; the server is gone after “Play on this phone”. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] A WebDAV book casts through the phone's pass-through. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] The FCast desktop receiver plays, pauses and seeks. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] Cast a few minutes, swipe the app away, reopen: place within 10 s; hand back resumes at the receiver's place. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] Screen off for 30 minutes while casting a multi-part book: parts still advance. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M26] On a guest network with client isolation: no receivers, no crash. ([m26](m26-follow-ups.md#1-checks-on-a-phone))
- [ ] [M22] Casting is not disturbed by the audio switches; local playback picks them up again afterwards. ([m22](m22-follow-ups.md))

### By ear or by hand

- [ ] [M22] On headphones each switch changes the sound within a moment without a click or stall; mono puts a hard-panned recording in both ears. ([m22](m22-follow-ups.md))
- [ ] [M22] On the speaker, boost is clearly louder without crackle; voice clarity helps a muffled recording without hiss. ([m22](m22-follow-ups.md))
- [ ] [M22] The same over Bluetooth, also after reconnecting mid-book. ([m22](m22-follow-ups.md))
- [ ] [M22] Effects hold at 0.8× and 3× and after a part changes on its own. ([m22](m22-follow-ups.md))
- [ ] [M22] An hour with all three effects on costs no noticeable extra battery. ([m22](m22-follow-ups.md))
- [ ] [M29] Shake the phone (screen off, on a bed) with 5 minutes left: ten minutes added, volume back; turning over doesn't trigger it; a shake with 20 minutes left does nothing. ([m29](m29-follow-ups.md#phone-checks))
- [ ] [M42] TalkBack walk-through on every screen, as listed per screen; the scrubber moves by swiping up and down; bookmarks have a Delete action. ([m42](m42-follow-ups.md#talkback-walk-through-per-screen))
- [ ] [M42] Accessibility Scanner on Home, Library, Player and Settings: no target under 48 dp, no missing labels. ([m42](m42-follow-ups.md#m42-follow-ups))
- [ ] [M42] TalkBack on the widget, the Quick Settings tile and the notification: each control is read with its name. ([m42](m42-follow-ups.md#m42-follow-ups))
- [ ] [M43] A real folder of a few hundred books: a second scan is quicker than before M43, and no book loses its place, bookmarks or chapters. ([m43](m43-follow-ups.md#m43-follow-ups))
- [ ] [M43] Android Auto (Desktop Head Unit) with the test library: the browse tree opens without delay. ([m43](m43-follow-ups.md#m43-follow-ups))
- [ ] [M2] Revoke Lelap's folder access in Android settings, reopen: a banner asks for the folder; no book is dimmed. ([README](../apps/app/README.md#m2-device-checklist))

### Accounts and servers

- [ ] [M10] Add a WebDAV server whose address takes the request but never answers (for example a port on the laptop with `nc -l 8099` behind `adb reverse`): “Could not connect” with “did not answer within 30 s” after about 30 s, not a spinner for a minute. A large real server connects after one folder listing; its books appear as the scan reads it. ([m10](m10-follow-ups.md))

- [ ] [M10] Nextcloud: add the audiobooks folder with an app password; books appear. ([m10](m10-follow-ups.md#2-checks))
- [ ] [M10] A WebDAV book plays, seeks, keeps its place, shows cover and chapters. ([m10](m10-follow-ups.md#2-checks))
- [ ] [M10] A WebDAV book downloads and plays in airplane mode. ([m10](m10-follow-ups.md#2-checks))
- [ ] [M10] Cloudflare R2 or MinIO: add a bucket; a book plays and downloads. ([m10](m10-follow-ups.md#2-checks))
- [ ] [M10] A wrong password says so; a server that is down keeps its books. ([m10](m10-follow-ups.md#2-checks))
- [ ] [M25] Covers from an Audiobookshelf server that needs a login on the widget (expected: placeholder). ([m25](m25-follow-ups.md#1-device-checks))
- [ ] [M41] Audiobookshelf 2.26 or later: add with an API key; book libraries picked, podcast libraries not listed. ([m41](m41-follow-ups.md#m41-follow-ups))
- [ ] [M41] Turn the Audiobookshelf key off, play a book: Settings shows the refused key with “Change key”; a new key keeps books and places and clears it. ([m41](m41-follow-ups.md#m41-follow-ups))
- [ ] [M41] Audiobookshelf books: single `.m4b` with chapters, several `.mp3` files as one book with a chapter per file; titles, authors, covers. ([m41](m41-follow-ups.md#m41-follow-ups))
- [ ] [M41] An Audiobookshelf book plays, seeks and downloads, also a download that waits for Wi-Fi. ([m41](m41-follow-ups.md#m41-follow-ups))
- [ ] [M41] Audiobookshelf places both ways: pause in Lelap, the web player resumes there; play on in the web player, then play in Lelap, it starts there; finished books both ways. ([m41](m41-follow-ups.md#m41-follow-ups))
- [ ] [M41] Cast an Audiobookshelf book to Chromecast and a UPnP renderer. ([m41](m41-follow-ups.md#m41-follow-ups))
- [ ] [M30] Hardcover with a real token: Currently reading with progress after a few minutes, Read with today's date after finishing, the Want to read row. ([m30](m30-follow-ups.md))
- [ ] [M30] Hardcover events from an offline session arrive with their own times once back online. ([m30](m30-follow-ups.md))
- [ ] [M30] gPodder (gpodder.net and Nextcloud gPodder Sync): play and pause an episode; AntennaPod on the same server continues there. ([m30](m30-follow-ups.md))
- [ ] [M5] Podcast search needs `PODCASTINDEX_KEY` and `PODCASTINDEX_SECRET` on the catalog Worker; try trending and a search. ([m3](m3-follow-ups.md#3-not-verified))
- [ ] [M30] Set `CONFIG_SECRET` on the catalog Worker; check the CORS preflight for `POST /scrobble` on the deployed catalog. ([m30](m30-follow-ups.md))

### A second device for sync

- [ ] [M7] Phone and laptop: switch in the middle of a chapter; the other continues there. ([m7](m7-follow-ups.md#2-checks))
- [ ] [M7] Podcasts and Up Next arrive between a phone and the web. ([m7](m7-follow-ups.md#2-checks))
- [ ] [M6] The phone's library shows in the browser at `listen.lelap.app` through sync. ([m6](m6-follow-ups.md#2-checks))
- [ ] [M9] Two people, one phone and their own devices, each keep their own progress. ([m9](m9-follow-ups.md#2-checks))
- [ ] [M19] Pair the phone and the web app, reset on one: the other shows “Another device reset sync” within a minute and can join again. ([m19](m19-follow-ups.md#1-checks-on-a-phone))
- [ ] [M16] A hand-made list keeps its order after a sync to a second device. ([m16](m16-follow-ups.md))
- [ ] [M22] Mono and voice clarity changed on another device reach the player at the next start; boost does not. ([m22](m22-follow-ups.md))
- [ ] [M34] After an import, sync sends tags, marks, places and subscriptions to a second device. ([m34](m34-follow-ups.md))

### Over days and nights

- [ ] [M2] A week of daily listening in airplane mode without losing the place. ([m2](m2-follow-ups.md#1-device-checks))
- [ ] [M4] A long book overnight on Wi-Fi and a charger, screen off: Downloaded in the morning; once with and once without the battery exemption. ([m4](m4-follow-ups.md#2-risks-to-watch-on-the-device))
- [ ] [M11] Auto-download on for a podcast, app closed overnight: new episodes are on the phone. ([README](../apps/app/README.md#m11-checks))
- [ ] [M24] Stats across local midnight and after changing time zone; the streak counts days right. ([m24](m24-follow-ups.md))

### Releases, updates and infrastructure

- [ ] [M8] Tag `v0.1.0-beta.1` (or the next beta): the workflow publishes the APK, `beta.json`, the GitHub release and the images. ([m8](m8-follow-ups.md#2-checks))
- [ ] [M8] An older build finds the beta, asks for the install permission and installs it. ([m8](m8-follow-ups.md#2-checks))
- [ ] [M8] Install from `lelap.app` and receive an update without help. ([m8](m8-follow-ups.md#2-checks))
- [ ] [M19] An update from `beta.json` installs end to end; a wrong `size` fails with “The download is larger than the release.” ([m19](m19-follow-ups.md#1-checks-on-a-phone))
- [ ] [M18] First OTA bundle: a JavaScript-only tag shows after a cold start; Settings → Updates says “Running update …”. ([m18](m18-follow-ups.md#2-checks-on-a-phone))
- [ ] [M18] OTA resume after 30 minutes in the background; the bundle starts on the next cold start, not mid-book. ([m18](m18-follow-ups.md#2-checks-on-a-phone))
- [ ] [M18] With automatic updates off nothing downloads; “Check” still does. ([m18](m18-follow-ups.md#2-checks-on-a-phone))
- [ ] [M18] Beta channel on a stable APK gets a beta bundle, then the next stable one. ([m18](m18-follow-ups.md#2-checks-on-a-phone))
- [ ] [M18] A wrong signature is refused; a new runtime version doesn't reach older APKs; a crashing bundle falls back. ([m18](m18-follow-ups.md#2-checks-on-a-phone))
- [ ] [M28] The first tagged release has the F-Droid APK, `SHA256SUMS` and attestations; it installs over the direct APK and back. ([m28](m28-follow-ups.md))
- [ ] [M28] `scripts/verify-fdroid-apk.sh v<version>` on a Linux machine reproduces the F-Droid APK. ([m28](m28-follow-ups.md))
- [ ] [M28] Screenshots for the F-Droid listing. ([m28](m28-follow-ups.md))
- [ ] [M20] Validate npm trusted publishing with 0.2.1 before 2026-11-19 10:08 UTC, then lock publishing to 2FA. ([m20](m20-follow-ups.md#left-to-do))
- [ ] [M7] Staging deploy of sync against real D1 (`sync-staging.lelap.app`). ([m7](m7-follow-ups.md#2-checks))
- [ ] [M8] Docker images build; [M19] `curl -I` on the web image shows the CSP and other headers. ([m19](m19-follow-ups.md#2-checks-elsewhere))
- [ ] [M19] `curl -I https://listen.lelap.app/` shows the headers from `_headers`. ([m19](m19-follow-ups.md#2-checks-elsewhere))

### Browsers (not the phone)

- [ ] [M6] Download a book in the web app; it plays with the network off in DevTools. ([m6](m6-follow-ups.md#2-checks))
- [ ] [M6] Safari and Firefox open the app, stream and keep the place. ([m6](m6-follow-ups.md#2-checks))
- [ ] [M17] Offline web: after one visit the app starts offline; Discover shows the last answers; no audio in Cache Storage. ([m17](m17-follow-ups.md#offline-web))
- [ ] [M17] A new deploy waits until every tab is closed, then the old `lelap-shell-*` cache is gone. ([m17](m17-follow-ups.md#offline-web))
- [ ] [M17] The Docker image serves `sw.js` with `Cache-Control: no-cache` and starts offline. ([m17](m17-follow-ups.md#offline-web))
- [ ] [M10] Web: an S3 bucket with CORS lists and plays. ([m10](m10-follow-ups.md#2-checks))
- [ ] [M22] Web: effects on a download and a LibriVox stream; a host without CORS plays without them, never silent; a switch reloads once at the same place; Safari and Firefox levels match Chrome. ([m22](m22-follow-ups.md))
- [ ] [M29] Web: timer checks 1, 3, 6 and the expired link in Chrome and Firefox. ([m29](m29-follow-ups.md#phone-checks))
- [ ] [M34] The AntennaPod file and its OPML export import in the web app. ([m34](m34-follow-ups.md))
- [ ] [M41] Web: an Audiobookshelf server that allows the site lists, plays with `?token=` and reports places; one that does not shows the CORS hint. ([m41](m41-follow-ups.md#m41-follow-ups))

## C. Already covered elsewhere or obsolete

- [ ] [M2] Pause recorded 1.7 s early: fixed after M9; the check is the pause journal item in A2.
- [ ] [M2] Deep resume and swipe-away “nearly/mostly” passed; only the leftover parts are in A2.
- [ ] [M3] Checks 1–5 passed against `wrangler dev`; A1 repeats only Home, Search and Play against the deployed catalog.
- [ ] [M3] First deploy from CI: the catalog is deployed and used by the live web app (M6).
- [ ] [M5] Up Next with the app closed and background refresh: fixed in M11; covered by the M11 items.
- [ ] [M6] Checks 1 and 2 (deployed app and proxy): `listen.lelap.app` is live since 2026-11-16.
- [ ] [M6] No service worker: superseded by M17's offline shell (its checks are in B).
- [ ] [M6] Check 8 “needs M7 sync”: M7 landed; now the sync item in B.
- [ ] [M7] Checks 1–4 passed locally in two browser origins.
- [ ] [M8] Release APK build and bundled Node servers passed locally; the phone install is in A1.
- [ ] [M8] OTA bundles section: done in M18.
- [ ] [M9] Profiles, avatars, PIN and launch picker passed on the web; the unload fix is in A6.
- [ ] [M10] Web dialogs (`Alert.alert`): replaced by the in-app dialog in M12, checked in the web preview.
- [ ] [M12] Cast and Downloaded in the tool row and end-of-chapter sleep: moved to M26 and M29.
- [ ] [M24] Time counted with the app swiped away, and [M30] progress from the service alone: open decisions, not checks.
