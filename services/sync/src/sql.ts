/** The statements both stores run: D1 on Workers and Node's SQLite in Docker. */
export const SQL = {
  createGroup:
    'INSERT OR IGNORE INTO groups (id, auth_hash, created_at, last_push_at) VALUES (?1, ?2, ?3, ?3)',
  group:
    'SELECT auth_hash, bytes, snapshot_seq, snapshot_parts, snapshot_upload, last_push_at FROM groups WHERE id = ?1',
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
    'SELECT data FROM snapshot_parts WHERE group_id = ?1 AND upload = ?2 AND idx >= ?3 AND idx < ?4 ORDER BY idx',
  /** What an upload already holds outside the parts it is about to replace. */
  stagedBytes:
    'SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM snapshot_parts WHERE group_id = ?1 AND upload = ?2 AND (idx < ?3 OR idx >= ?4)',
  /** A new upload makes other unfinished ones for the same or an older point pointless. */
  dropOtherUploads: `DELETE FROM snapshot_parts WHERE group_id = ?1 AND covers <= ?2 AND upload <> ?3
      AND upload <> (SELECT snapshot_upload FROM groups WHERE id = ?1)`,
  // Checked here as well as in the route, so a part never lands once its snapshot is not newer.
  putPart: `INSERT OR REPLACE INTO snapshot_parts (group_id, upload, covers, idx, data)
      SELECT ?1, ?2, ?3, ?4, ?5 WHERE ?3 > (SELECT snapshot_seq FROM groups WHERE id = ?1)`,
  // Only when it is newer than the current one, covers messages that exist, and is complete.
  commit: `UPDATE groups SET snapshot_seq = ?2, snapshot_parts = ?3, snapshot_upload = ?4,
      last_push_at = ?5
    WHERE id = ?1 AND snapshot_seq < ?2
      AND ?2 <= (SELECT COALESCE(MAX(seq), 0) FROM messages WHERE group_id = ?1)
      AND (SELECT COUNT(*) FROM snapshot_parts
        WHERE group_id = ?1 AND upload = ?4 AND covers = ?2 AND idx < ?3) = ?3`,
  // Each of these reads the group's snapshot as it is after the commit, so a commit that lost a
  // race to a newer snapshot removes nothing the newer one still needs.
  dropReplacedParts: `DELETE FROM snapshot_parts WHERE group_id = ?1 AND (
      (upload <> (SELECT snapshot_upload FROM groups WHERE id = ?1)
        AND covers <= (SELECT snapshot_seq FROM groups WHERE id = ?1))
      OR (upload = (SELECT snapshot_upload FROM groups WHERE id = ?1)
        AND idx >= (SELECT snapshot_parts FROM groups WHERE id = ?1)))`,
  dropCovered:
    'DELETE FROM messages WHERE group_id = ?1 AND seq <= (SELECT snapshot_seq FROM groups WHERE id = ?1)',
  // Uploads in progress don't count, so an abandoned one never fills a group.
  recount: `UPDATE groups SET bytes =
      (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM messages WHERE group_id = ?1)
      + (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM snapshot_parts
        WHERE group_id = ?1 AND upload = (SELECT snapshot_upload FROM groups WHERE id = ?1))
    WHERE id = ?1`,
  // created_at too: groups made by the previous Worker between migration and deploy have 0.
  idle: 'SELECT id FROM groups WHERE MAX(last_push_at, created_at) < ?1 LIMIT ?2',
  // Each only while the group is still idle, so a push after the SELECT above keeps it.
  dropIdleMessages: `DELETE FROM messages WHERE group_id = ?1 AND EXISTS
      (SELECT 1 FROM groups WHERE id = ?1 AND MAX(last_push_at, created_at) < ?2)`,
  dropIdleParts: `DELETE FROM snapshot_parts WHERE group_id = ?1 AND EXISTS
      (SELECT 1 FROM groups WHERE id = ?1 AND MAX(last_push_at, created_at) < ?2)`,
  dropIdleGroup: 'DELETE FROM groups WHERE id = ?1 AND MAX(last_push_at, created_at) < ?2',
  dropExpiredPairings: 'DELETE FROM pairings WHERE expires_at < ?1',
  putPairing: 'INSERT OR IGNORE INTO pairings (lookup, blob, expires_at) VALUES (?1, ?2, ?3)',
  takePairing: 'DELETE FROM pairings WHERE lookup = ?1 RETURNING blob, expires_at',
} as const;

export type GroupRow = {
  auth_hash: string;
  bytes: number;
  snapshot_seq: number;
  snapshot_parts: number;
  snapshot_upload: string;
  last_push_at: number;
};

export const toGroup = (row: GroupRow) => ({
  authHash: row.auth_hash,
  bytes: row.bytes,
  snapshotSeq: row.snapshot_seq,
  snapshotParts: row.snapshot_parts,
  snapshotUpload: row.snapshot_upload,
  lastPushAt: row.last_push_at,
});

/** Groups deleted per round of the expiry job, so one run stays within D1's limits. */
export const EXPIRE_BATCH = 10;
