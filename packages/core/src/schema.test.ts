import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { DEFAULT_PROFILE_ID } from './profiles';
import { profiles, SHARED_TABLES } from './schema';

describe('schema', () => {
  it('gives every non-shared table a profile_id', () => {
    const db = createTestDb();
    const tables = db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .filter(({ name }) => !name.startsWith('__') && !name.startsWith('sqlite_'));
    expect(tables.length).toBeGreaterThan(5);
    for (const { name } of tables) {
      if ((SHARED_TABLES as readonly string[]).includes(name)) continue;
      const columns = db.all<{ name: string }>(sql.raw(`pragma table_info(${name})`));
      expect(
        columns.map((c) => c.name),
        name,
      ).toContain('profile_id');
    }
  });

  it('creates the default profile in the first migration', () => {
    const db = createTestDb();
    expect(db.select().from(profiles).all()).toEqual([
      expect.objectContaining({ id: DEFAULT_PROFILE_ID, name: 'Me' }),
    ]);
  });
});
