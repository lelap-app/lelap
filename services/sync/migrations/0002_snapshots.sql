-- M52. A group keeps its newest sealed snapshot; the messages up to `snapshot_seq` are gone.
ALTER TABLE groups ADD COLUMN snapshot_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN snapshot_parts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN snapshot_upload TEXT NOT NULL DEFAULT '';

-- When a device last pushed. Groups idle longer than SYNC_IDLE_EXPIRY_DAYS are deleted.
ALTER TABLE groups ADD COLUMN last_push_at INTEGER NOT NULL DEFAULT 0;
UPDATE groups SET last_push_at = COALESCE(
  (SELECT MAX(created_at) FROM messages WHERE messages.group_id = groups.id),
  created_at
);

-- A snapshot in parts of up to 256 KB, as messages are. Each upload has a random ID, so two
-- devices writing one at once never mix parts; parts of other uploads than the group's
-- `snapshot_upload` are uploads in progress.
CREATE TABLE snapshot_parts (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  upload TEXT NOT NULL,
  covers INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (group_id, upload, idx)
);
