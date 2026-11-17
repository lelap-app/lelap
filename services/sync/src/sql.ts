/** The statements both stores run: D1 on Workers and Node's SQLite in Docker. */
export const SQL = {
  createGroup:
    'INSERT OR IGNORE INTO groups (id, auth_hash, created_at, last_push_at) VALUES (?1, ?2, ?3, ?3)',
  group:
    'SELECT auth_hash, bytes, snapshot_seq, snapshot_parts, last_push_at FROM groups WHERE id = ?1',
  deleteMessages: 'DELETE FROM messages WHERE group_id = ?1',
  deleteParts: 'DELETE FROM snapshot_parts WHERE group_id = ?1',
  deleteGroup: 'DELETE FROM groups WHERE id = ?1',
  insertMessage:
    'INSERT INTO messages (group_id, device, data, created_at) VALUES (?1, ?2, ?3, ?4)',
  pushed: 'UPDATE groups SET bytes = bytes + ?2, last_push_at = ?3 WHERE id = ?1',
  read: 'SELECT seq, device, data, created_at AS at FROM messages WHERE group_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3',
  older:
    'SELECT COUNT(*) AS messages, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM messages WHERE group_id = ?1 AND created_at < ?2',
  readParts:
    'SELECT data FROM snapshot_parts WHERE group_id = ?1 AND covers = ?2 AND idx >= ?3 AND idx < ?4 ORDER BY idx',
  /** What an upload of `covers` already holds outside the parts it is about to replace. */
  stagedBytes:
    'SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM snapshot_parts WHERE group_id = ?1 AND covers = ?2 AND (idx < ?3 OR idx >= ?4)',
  /** An upload for a newer point makes an older unfinished one pointless. */
  dropOlderUploads:
    'DELETE FROM snapshot_parts WHERE group_id = ?1 AND covers < ?2 AND covers <> (SELECT snapshot_seq FROM groups WHERE id = ?1)',
  putPart:
    'INSERT OR REPLACE INTO snapshot_parts (group_id, covers, idx, data) VALUES (?1, ?2, ?3, ?4)',
  // Only when it is newer than the current one, covers messages that exist, and is complete.
  commit: `UPDATE groups SET snapshot_seq = ?2, snapshot_parts = ?3, last_push_at = ?4
    WHERE id = ?1 AND snapshot_seq < ?2
      AND ?2 <= (SELECT COALESCE(MAX(seq), 0) FROM messages WHERE group_id = ?1)
      AND (SELECT COUNT(*) FROM snapshot_parts WHERE group_id = ?1 AND covers = ?2 AND idx < ?3) = ?3`,
  // Each of these reads the group's snapshot as it is after the commit, so a commit that lost a
  // race to a newer snapshot removes nothing the newer one still needs.
  dropReplacedParts: `DELETE FROM snapshot_parts WHERE group_id = ?1 AND (
      covers < (SELECT snapshot_seq FROM groups WHERE id = ?1)
      OR (covers = (SELECT snapshot_seq FROM groups WHERE id = ?1)
        AND idx >= (SELECT snapshot_parts FROM groups WHERE id = ?1)))`,
  dropCovered:
    'DELETE FROM messages WHERE group_id = ?1 AND seq <= (SELECT snapshot_seq FROM groups WHERE id = ?1)',
  recount: `UPDATE groups SET bytes =
      (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM messages WHERE group_id = ?1)
      + (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM snapshot_parts WHERE group_id = ?1)
    WHERE id = ?1`,
  idle: 'SELECT id FROM groups WHERE last_push_at < ?1 LIMIT ?2',
  dropExpiredPairings: 'DELETE FROM pairings WHERE expires_at < ?1',
  putPairing: 'INSERT OR IGNORE INTO pairings (lookup, blob, expires_at) VALUES (?1, ?2, ?3)',
  takePairing: 'DELETE FROM pairings WHERE lookup = ?1 RETURNING blob, expires_at',
} as const;

export type GroupRow = {
  auth_hash: string;
  bytes: number;
  snapshot_seq: number;
  snapshot_parts: number;
  last_push_at: number;
};

export const toGroup = (row: GroupRow) => ({
  authHash: row.auth_hash,
  bytes: row.bytes,
  snapshotSeq: row.snapshot_seq,
  snapshotParts: row.snapshot_parts,
  lastPushAt: row.last_push_at,
});

/** Groups deleted per round of the expiry job, so one run stays within D1's limits. */
export const EXPIRE_BATCH = 50;
