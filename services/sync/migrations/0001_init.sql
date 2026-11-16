-- Sync groups. The server knows a group by a random ID and the SHA-256 of its auth token.
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  auth_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Sealed messages, in the order they arrived. `device` is a random ID per device.
CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  device TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_group_seq ON messages (group_id, seq);

-- A group secret sealed with a key from a pairing code; taken once, gone after ten minutes.
CREATE TABLE pairings (
  lookup TEXT PRIMARY KEY,
  blob TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
