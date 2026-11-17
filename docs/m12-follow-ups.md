# M12 follow-ups

Checked in the web preview (icons, Player layout, dialog with buttons, search status line). Open on
a phone, with a new debug or release build (M12 adds the `expo-network` native module):

- Icons render crisp on Android, in the tab bar, Player, mini player, Up Next and headers.
- The Player fits on a small phone without the tool row touching the gesture bar.
- Airplane mode shows the Library banner and hides it again when the network returns.
- Android keeps its system dialogs (remove add-on, delete bookmark, download actions).
- With “Remove animations” on in Android's accessibility settings, nothing fades or scales.
- TalkBack reads the Player buttons by name (Back 30 seconds, Play, Next chapter, …).

Left for later in M12: the sketch's Discover badges and “Playable only” filter (M31), Cast and
Downloaded in the Player's tool row (M26), end-of-chapter sleep (M29).
