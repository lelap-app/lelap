# M52 follow-ups

What is left of [M52 Sync upkeep](milestones/m52.md). Design notes are in
[the brief](brief.md#sync).

Covered by tests: folding operations into a snapshot (newest per row, fields older versions leave
out, deletions, unknown types), sealing in parts bound to their place; a new device joining from a
snapshot, a device behind one catching up with its own newer changes kept, changes for books the
compacting device lacks surviving, a snapshot built on the one before, nothing dropped that can't
be read (core, Vitest). On the Worker with local D1 (wrangler's `getPlatformProxy`): uploads,
commits, paging, old clients stopped with 410 behind a snapshot, the 50 MB cap with a snapshot,
two uploads at once never mixing, the cron handler with `SYNC_IDLE_EXPIRY_DAYS` set and unset, the
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
  the format) stops compaction for that group for good. Nothing is lost; the group keeps its log
  and can fill up again.
- An app from before M52 that is more than 30 days behind, or pairs into a group with a snapshot,
  stops syncing until it is updated. It keeps its own data and pushes it after the update.
- Uploads in progress don't count towards the 50 MB cap until committed, so a full group can
  still be compacted (a push refused as full triggers a snapshot and one retry). An abandoned
  upload stays until a newer one starts or a snapshot is committed.

## 4. Minor findings from the review

- Expiry counts pushes only. A device that only pulls (nothing changed for 2 years) loses the
  group like an idle one. Touching `last_push_at` on pulls (throttled) would avoid that.
- An app version that meets operation types it does not know keeps all of them unfolded, so each
  snapshot it writes carries them forward. Newer versions fold them; worth a cap if old versions
  linger.
- One change larger than about 180 KB (a book with thousands of chapters) can't go into a
  snapshot part; compaction then stops for that group (checked before upload, nothing is lost).
