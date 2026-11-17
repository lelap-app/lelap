# M52 follow-ups

What is left of [M52 Sync upkeep](milestones/m52.md). Design notes are in
[the brief](brief.md#sync).

Covered by tests: folding operations into a snapshot (newest per row, fields older versions leave
out, deletions, unknown types), sealing in parts bound to their place; a new device joining from a
snapshot, a device behind one catching up with its own newer changes kept, changes for books the
compacting device lacks surviving, a snapshot built on the one before, nothing dropped that can't
be read (core, Vitest). On the Worker with local D1 (wrangler's `getPlatformProxy`): uploads,
commits, paging, old clients stopped with 410 behind a snapshot, the 50 MB cap with a snapshot,
unfinished uploads dropped, the cron handler with `SYNC_IDLE_EXPIRY_DAYS` set and unset, the
migration on a database with groups, and the app engine compacting and joining end to end. The
Node store for Docker runs the same SQL (Vitest on `node:sqlite`).

`@cloudflare/vitest-pool-workers` was not used: its newest version (0.23.0) needs Vitest 4, and the
repository is on Vitest 5.

## 1. Setup before it is live

- **Production expiry:** set the variable `SYNC_IDLE_EXPIRY_DAYS` = `730` in the `release` GitHub
  environment. The next `v*` tag deploys sync with `--var SYNC_IDLE_EXPIRY_DAYS:730`. Staging reads
  `SYNC_STAGING_IDLE_EXPIRY_DAYS` from the `web` environment; leave it unset to keep staging groups.
- The deploys apply `migrations/0002_snapshots.sql` (staging on `main`, production on tags) and
  register the daily cron trigger.

## 2. Checks

- Staging: after the deploy, `wrangler d1 execute lelap-sync-staging --remote --command "SELECT
id, last_push_at, snapshot_seq FROM groups"` shows dates from the last push, and the Worker's
  cron trigger appears in the dashboard.
- Two devices on staging: set the phone's clock (or wait) so the group has over 1 MB of messages
  older than 30 days; the next sync writes a snapshot, and a newly paired device gets the library.
- An app from before M52 on a device that missed a snapshot: Settings → Diagnostics shows the sync
  failure with HTTP 410, its library is unchanged, and after updating the app it syncs again.
- Docker: `docker compose up sync` with `SYNC_IDLE_EXPIRY_DAYS=1`; a group untouched for a day is
  gone after the next start.

## 3. Known limits

- A device whose group expired shows “Another device reset sync”: the server can't tell a deleted
  group from an expired one. The text could say “Sync stopped” for both.
- A message that does not open with the group key (damaged, or from a newer version that changes
  the format) stops compaction for that group until it is younger than the snapshot point, which
  it never becomes. Nothing is lost; the group just keeps its log.
- An app from before M52 that is more than 30 days behind, or pairs into a group with a snapshot,
  stops syncing until it is updated. It keeps its own data and pushes it after the update.
- While a snapshot uploads, the group may hold up to one extra snapshot beyond the 50 MB cap; the
  commit frees it.
