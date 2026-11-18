# Back up and restore

Two volumes hold what a self-hosted Lelap can't make again:

| Volume      | What                                       | Lost means                                   |
| ----------- | ------------------------------------------ | -------------------------------------------- |
| `sync-data` | `sync.db`: sealed sync messages and groups | Every device pairs again; their data stays   |
| `secrets`   | `admin_token`, `config_secret` (generated) | Listeners set up Hardcover and gPodder again |

Nothing else needs a backup: the catalog and proxy keep only a cache in memory, and the web app is
built from the repository. The sync database is sealed: a backup holds no keys and nothing a
reader of the file could decrypt, but keep it as private as the server.

The commands below run in the `docker` folder, with the compose project as `docker compose up`
started it.

## Back up the sync database

While sync runs:

```sh
docker compose exec sync node sync-db.mjs backup
docker compose cp sync:/data/backups/. ./backups/
docker compose exec sync sh -c 'rm /data/backups/*'
```

`backup` uses SQLite's online backup, so the copy is whole even while devices push. It writes
`/data/backups/sync-<date and time>.db` and prints the name; pass a path to choose another. Then
check the copy on the machine that keeps it:

```sh
docker compose run --rm --no-deps -v "$PWD/backups:/backups:ro" sync \
  node sync-db.mjs verify /backups/sync-2026-11-18T03-00-00.db
```

Do not copy `sync.db` itself out of a running container: SQLite keeps recent writes in
`sync.db-wal`, and a copy taken mid-write can be broken.

To back up every night, a cron line on the host (all three commands joined with `&&`) is enough.
Devices replace old messages with a snapshot, so each backup is about the size of the groups the
sync admin page shows.

## Restore the sync database

A restore puts every group back as it was at the backup. What devices sent after it is gone from
the server: each device keeps its own changes, but the others don't receive them. Groups made after
the backup are gone too, and those devices pair again. The restore numbers new messages far past
the old ones, so devices that synced after the backup keep receiving what comes next.

```sh
docker compose stop sync
docker compose run --rm --no-deps -v "$PWD/backups:/backups:ro" sync \
  node sync-db.mjs restore /backups/sync-2026-11-18T03-00-00.db
docker compose start sync
```

`restore` checks the backup first (SQLite's integrity check, and that it is a sync database) and
refuses anything else. It keeps the database it replaces as `/data/sync.db.replaced-<date>`;
delete that once sync runs well. On start, sync applies any migrations the backup is missing, so
a backup from an older version restores into a newer one.

## Back up the secrets

They change only if you change them, so one copy is enough:

```sh
docker compose exec sync cat /secrets/admin_token /secrets/config_secret
```

Keep the two lines in your password manager. To restore them on a new server, put them in `.env`
as `ADMIN_TOKEN=` and `CONFIG_SECRET=`: values in `.env` win over generated ones.

## Move to a new server

1. On the old server: back up the sync database and the secrets as above.
2. On the new one: clone the repository, copy `.env` with the two secrets in it, and run
   `docker compose up -d`.
3. Restore the sync database as above, then point DNS at the new server.
