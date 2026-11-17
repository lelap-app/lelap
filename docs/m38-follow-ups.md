# M38 follow-ups

Checked in the web preview: installing `examples/in-app-addon/home-shelf.js` (pointed at a test
server on the laptop) shows “Runs on this device, in a sandbox. It can reach only …” and the code
fingerprint; after Add, Home gets its catalog and the source badge, all through the sandbox.
Covered by tests: the host allowlist (ports, `*.` names, other schemes and user info refused),
`lelap-local://` routing, code removed with its add-on.

Open:

- **Android:** the first build with `react-native-webview` (a new native module). Install the
  example pointed at a server on the home network; play a book from it with the screen off.
- A fetch to a host the add-on didn't declare fails with “Not allowed”, and nothing else is
  reachable from the page (its content policy blocks network, frames and storage).
- A file that loops forever: calls time out after 20 s and the rest of the app keeps working.
- Removing the add-on removes its code (`local_addon_code`) and closes its sandbox.
- Updating: installing a new version of the same file replaces the code and restarts the sandbox.
- Follow-up idea: honour `cacheMaxAge` from add-on answers instead of the app's fixed 5 minutes.
