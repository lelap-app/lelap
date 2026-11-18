import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createApp } from '../../../services/sync/src/app';
import { runUpkeep } from '../../../services/sync/src/expiry';
import { adminFromEnv } from './admin';
import { port, serve } from './serve';
import { migrate, sqliteStore } from './sqliteStore';
import { syncStatus } from './syncAdmin';
import { syncMigrations } from './syncMigrations';

const file = process.env.SYNC_DB ?? '/data/sync.db';
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
migrate(db, syncMigrations);

const store = sqliteStore(db);
// Closing checkpoints the WAL, so the volume holds one whole file after a stop.
const servicePort = port(8789);
serve(createApp(store), servicePort, 'sync', () => db.close());
adminFromEnv('sync', servicePort, {
  // /health runs often and without the token: one cheap query, never the group listing.
  health: async () => {
    db.prepare('SELECT 1').get();
    return [{ name: 'Database', ok: true, detail: 'Answers' }];
  },
  status: async () => syncStatus(db, process.env.SYNC_IDLE_EXPIRY_DAYS),
});

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
