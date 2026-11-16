import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import init from '../../../services/sync/migrations/0001_init.sql';
import { createApp } from '../../../services/sync/src/app';
import { port, serve } from './serve';
import { migrate, sqliteStore } from './sqliteStore';

const file = process.env.SYNC_DB ?? '/data/sync.db';
mkdirSync(dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
migrate(db, { '0001_init.sql': init });

serve(createApp(sqliteStore(db)), port(8789), 'sync');
