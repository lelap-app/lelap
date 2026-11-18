# @lelap/bluetooth

Kotlin Expo module that follows the connected Bluetooth audio devices (M33): their name, battery
level and whether one is a car (device class car audio or hands-free). The app uses it for the low
headphone battery banner and to offer car mode.

- Opt-in: it only runs between `start()` and `stop()`, which the app calls when the listener turns
  on one of the two settings. On Android 12+ that needs the nearby devices permission
  (`BLUETOOTH_CONNECT`), asked for at that moment; no scanning and no location.
- Levels come from the system's battery broadcast (`android.bluetooth.device.action.BATTERY_LEVEL_CHANGED`),
  sent at connection and on every change. For devices connected before `start()` the module reads
  the level the system already knows, through a getter the SDK keeps hidden; when that fails, the
  level shows with the next broadcast. Devices that report nothing have no level.
- `AudioDevices` holds the rules (audio devices only, car classes, valid levels) and is tested on
  the JVM: `cd apps/app/android && ./gradlew :lelap-bluetooth:testDebugUnitTest`.

The app adds two things on top, kept on the phone in `apps/app/src/devices.tsx` (M74): cars the
listener marked in Settings, for cars that report as headphones, and each headphones' measured
drain, so the battery estimate learns from real use (`packages/core/src/headphones.ts`).

The web has nothing like it; `apps/app/src/platform/bluetooth.web.ts` reports no devices.
