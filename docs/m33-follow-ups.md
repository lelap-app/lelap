# M33 follow-ups

What is left of M33 Everyday Android ([`milestones/m33.md`](milestones/m33.md)) after its first
pull request. M33 stays “In progress” until the device checks pass.

## What landed

- `modules/audio`: media button preferences with back and forward by the skip interval
  (`COMMAND_SEEK_BACK` and `COMMAND_SEEK_FORWARD`, icons from `SkipIcons`) next to the sleep timer
  button; `Bedtime` and a check in `onPlayWhenReadyChanged` that starts the bedtime timer, once
  per night; `setBedtime` in the JavaScript bridge writes the window to the service's preferences.
- `modules/bluetooth` (new): connected Bluetooth audio devices with battery level and a car flag,
  from the ACL and battery broadcasts, running only while one of its settings is on.
- `@lelap/core`: seven settings (bedtime window, length and chapter switch; headphone battery; car
  mode offer) and `headphoneWarning` with its drain estimate, tested.
- App: `app/car.tsx` (car mode), a car button in the player header, `HeadphoneBanner` in the
  Library (under the offline banner), the player and car mode, the settings rows, and
  `DeviceRunner`, which follows devices and offers car mode when a car connects.

## 1. Device checks

Not run (no phone testing for now).

| #   | Check                                                                                                                                 | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Notification and lock screen show back and forward with “30” (and “15” after changing the skip interval), and they skip across files  | Not run |
| 2   | A paired Wear OS watch shows play or pause, back and forward with the seconds, and the sleep timer in its extra actions; each works   | Not run |
| 3   | The watch's controls also work with the app swiped away, and in the F-Droid build                                                     | Not run |
| 4   | Android Auto still shows back, forward and the sleep timer button and they work                                                       | Not run |
| 5   | Bedtime on, window around now: Play starts the chosen timer; the player shows it; turning it off and pressing Play again keeps it off | Not run |
| 6   | Bedtime window across midnight (23:00 to 01:00): Play at 00:30 starts the timer; the next night it starts again                       | Not run |
| 7   | Bedtime with end of chapter: Play starts a chapter timer; with the app swiped away, headphone Play inside the window also starts it   | Not run |
| 8   | Turning on the headphone battery warning asks for nearby devices once; refusing keeps the switch off and explains why                 | Not run |
| 9   | Earbuds that report a level: the banner appears at a low level with a long sleep timer and goes away when the timer is shorter        | Not run |
| 10  | Earbuds connected before Lelap started show their level right away (hidden getter), or with their next report                         | Not run |
| 11  | A speaker or earbuds that report no level show no banner                                                                              | Not run |
| 12  | Car mode from the player: big buttons work, the screen stays on, Exit returns to the player; legible in sunlight                      | Not run |
| 13  | Offer car mode on: connecting to a car's Bluetooth asks to open car mode; headphones don't                                            | Not run |
| 14  | Car mode's sleep button steps 15 min → 30 min → end of chapter → off                                                                  | Not run |

## 2. Open questions

- Cars that report themselves only as a generic audio device are not detected; the car button in
  the player stays the way in. A list of “this is my car” devices could follow if it matters.
- The drain estimate assumes at least 20 % per hour. Real numbers from a few earbuds could refine
  it; the measured drain already wins when it is faster.
- Car mode has no previous-chapter button, to keep five targets; the player has one.
