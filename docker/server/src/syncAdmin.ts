import type { DatabaseSync } from 'node:sqlite';

import { formatBytes, type Status } from './admin';

const day = (ms: number) => (ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '');

/** The groups listed, largest first; the totals count every group. */
export const LISTED_GROUPS = 100;

/**
 * The sync database at a glance: totals, and the largest groups. A group shows as the first 8
 * characters of its random ID, its size, message count and dates; messages stay sealed.
 */
export function syncStatus(db: DatabaseSync, idleExpiryDays: string | undefined): Status {
  const one = <T>(sql: string) => db.prepare(sql).get() as T;
  const totals = one<{ groups: number; bytes: number }>(
    'SELECT COUNT(*) AS groups, COALESCE(SUM(bytes), 0) AS bytes FROM groups',
  );
  const { messages } = one<{ messages: number }>('SELECT COUNT(*) AS messages FROM messages');
  const { pairings } = one<{ pairings: number }>('SELECT COUNT(*) AS pairings FROM pairings');
  const { page_count } = one<{ page_count: number }>('PRAGMA page_count');
  const { page_size } = one<{ page_size: number }>('PRAGMA page_size');
  const { freelist_count } = one<{ freelist_count: number }>('PRAGMA freelist_count');
  const groups = db
    .prepare(
      `SELECT substr(id, 1, 8) AS id, bytes, snapshot_parts, created_at, last_push_at,
        (SELECT COUNT(*) FROM messages WHERE group_id = groups.id) AS messages
      FROM groups ORDER BY bytes DESC, created_at LIMIT ?`,
    )
    .all(LISTED_GROUPS) as {
    id: string;
    bytes: number;
    snapshot_parts: number;
    created_at: number;
    last_push_at: number;
    messages: number;
  }[];
  const days = Number(idleExpiryDays);
  return {
    checks: [],
    settings: [
      ['Groups', String(totals.groups)],
      ['Stored', formatBytes(totals.bytes)],
      ['Messages', String(messages)],
      ['Pairings waiting', String(pairings)],
      [
        'Database file',
        `${formatBytes(page_count * page_size)}, ${formatBytes(freelist_count * page_size)} of it free`,
      ],
      ['Idle groups expire', days > 0 ? `after ${days} days` : 'never'],
    ],
    tables: [
      {
        title: 'Sync groups',
        note:
          totals.groups > groups.length
            ? `The ${groups.length} largest of ${totals.groups}.`
            : 'Largest first. Everything in them is sealed; the server holds no keys.',
        columns: ['Group', 'Size', 'Messages', 'Snapshot parts', 'Created', 'Last sync'],
        rows: groups.map((g) => [
          `${g.id}…`,
          formatBytes(g.bytes),
          g.messages,
          g.snapshot_parts,
          day(g.created_at),
          day(g.last_push_at),
        ]),
      },
    ],
  };
}
