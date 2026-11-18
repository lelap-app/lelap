// Backups for the sync database, in the sync image (docker/README.md, "Back up and restore"):
//   node sync-db.mjs backup [target]   while the server runs
//   node sync-db.mjs verify <file>
//   node sync-db.mjs restore <file>    with the server stopped
import { backupSync, restoreSync, verifySync } from './backup';
import { syncMigrations } from './syncMigrations';

const file = process.env.SYNC_DB ?? '/data/sync.db';
const [command, path] = process.argv.slice(2);
// A backup from a newer image is refused: this one would run against a schema it doesn't know.
const known = Object.keys(syncMigrations);

try {
  if (command === 'backup') {
    console.log(`Backed up to ${await backupSync(file, path)}`);
  } else if (command === 'verify' && path) {
    console.log(`${path} is intact: ${verifySync(path, known).groups} groups.`);
  } else if (command === 'restore' && path) {
    console.log(`Restored ${restoreSync(file, path, known).groups} groups into ${file}.`);
  } else {
    console.error('Usage: node sync-db.mjs backup [target] | verify <file> | restore <file>');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
