// Backups for the sync database, in the sync image (docker/README.md, "Back up and restore"):
//   node sync-db.mjs backup [target]   while the server runs
//   node sync-db.mjs verify <file>
//   node sync-db.mjs restore <file>    with the server stopped
import { backupSync, restoreSync, verifySync } from './backup';

const file = process.env.SYNC_DB ?? '/data/sync.db';
const [command, path] = process.argv.slice(2);

try {
  if (command === 'backup') {
    console.log(`Backed up to ${await backupSync(file, path)}`);
  } else if (command === 'verify' && path) {
    console.log(`${path} is intact: ${verifySync(path).groups} groups.`);
  } else if (command === 'restore' && path) {
    console.log(`Restored ${restoreSync(file, path).groups} groups into ${file}.`);
  } else {
    console.error('Usage: node sync-db.mjs backup [target] | verify <file> | restore <file>');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
