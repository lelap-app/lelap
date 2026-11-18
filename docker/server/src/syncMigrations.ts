import init from '../../../services/sync/migrations/0001_init.sql';
import snapshots from '../../../services/sync/migrations/0002_snapshots.sql';

/** The sync database's migrations this image knows, by file name. Add new ones here. */
export const syncMigrations: Record<string, string> = {
  '0001_init.sql': init,
  '0002_snapshots.sql': snapshots,
};
