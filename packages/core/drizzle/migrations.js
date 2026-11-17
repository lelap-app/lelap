// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_default_profile.sql';
import m0002 from './0002_addons.sql';
import m0003 from './0003_downloads.sql';
import m0004 from './0004_podcasts.sql';
import m0005 from './0005_sync.sql';
import m0006 from './0006_profiles.sql';
import m0007 from './0007_remote_roots.sql';
import m0008 from './0008_organise.sql';
import m0009 from './0009_podcasting.sql';
import m0010 from './0010_listening_log.sql';
import m0011 from './0011_scrobble_outbox.sql';
import m0012 from './0012_local_addons.sql';
import m0013 from './0013_big_libraries.sql';
import m0014 from './0014_trim_silence.sql';

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
    m0009,
    m0010,
    m0011,
    m0012,
    m0013,
    m0014,
  },
};
