import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import init from '../../../services/sync/migrations/0001_init.sql';
import snapshots from '../../../services/sync/migrations/0002_snapshots.sql';
import { createApp } from '../../../services/sync/src/app';
import { runUpkeep } from '../../../services/sync/src/expiry';
import { port, serve } from './serve';
import { migrate, sqliteStore } from './sqliteStore';

const file = process.env.SYNC_DB ?? '/data/sync.db';
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
migrate(db, { '0001_init.sql': init, '0002_snapshots.sql': snapshots });

const store = sqliteStore(db);
serve(createApp(store), port(8789), 'sync');

// What the Worker's daily cron trigger does: old pairings, and idle groups when
// SYNC_IDLE_EXPIRY_DAYS is set. Once at start, then once a day.
const UPKEEP_EVERY_MS = 24 * 60 * 60_000;
const upkeep = () =>
  runUpkeep(store, process.env.SYNC_IDLE_EXPIRY_DAYS, Date.now())
    .then(({ expired }) => {
      if (expired > 0) console.log(`sync: removed ${expired} idle groups`);
    })
    .catch((error: unknown) => console.error('sync: upkeep failed', error));
void upkeep();
setInterval(() => void upkeep(), UPKEEP_EVERY_MS);
