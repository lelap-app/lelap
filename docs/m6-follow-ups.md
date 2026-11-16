# M6 follow-ups

What is left of [M6 Web build](roadmap.md#m6-web-build) after PR #16.

## 1. Setup before it is live

- Create the Pages project `lelap-web` with the custom domain `listen.lelap.app`; re-run
  “Deploy web app”.
- In the `web` environment: `PROXY_DOMAIN` = `proxy.lelap.app`, `WEB_ORIGIN` =
  `https://listen.lelap.app`. Until then the proxy deploys to `workers.dev` and allows any origin.
- Add the free plan's rate limiting rule for the proxy hostname.

## 2. Checks

Steps are in [`apps/app/README.md`](../apps/app/README.md#m6-web-checklist). Run in Chrome on
2026-11-16 against `expo start --web` and `wrangler dev`:

| #   | Check                                                  | Status                      |
| --- | ------------------------------------------------------ | --------------------------- |
| 1   | Deployed app at `listen.lelap.app`                     | Not run (needs setup)       |
| 2   | Deployed proxy answers `/feed`                         | Not run (needs setup)       |
| 3   | Stream a LibriVox book; skip, speed, sleep timer, keys | Pass locally (play, skip)   |
| 4   | Place survives a reload                                | Pass locally                |
| 5   | Subscribe by feed address; play an episode             | Pass locally (LibriVox RSS) |
| 6   | Download a book; it plays with the network off         | Not run                     |
| 7   | Safari and Firefox                                     | Not run                     |
| 8   | **Done-when:** the phone's library in the browser      | Needs M7 sync               |

## 3. Deferred

- No PWA manifest or service worker yet, so the app is not installable and needs the network to
  load its code.
- Web downloads need CORS on the audio host and stop when the tab closes.
