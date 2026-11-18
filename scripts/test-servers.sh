#!/usr/bin/env bash
# Starts or removes the WebDAV and S3 servers `pnpm test:integration` runs against (M94), on
# localhost only. CI uses it too: both images need a command, which service containers can't take.
#   scripts/test-servers.sh up|down
# Ports: LELAP_TEST_WEBDAV_PORT (18081) and LELAP_TEST_S3_PORT (19190). The logins are test values
# that packages/core/integration/servers.ts repeats.
set -euo pipefail

# rclone 1.71.2.
WEBDAV_IMAGE='rclone/rclone@sha256:3103526c506266a9ecdf064efe99bf3677d92ef6407af124d8c56b4f49cbaa51'
# MinIO RELEASE.2026-08-04, from the community-maintained build: minio/minio is gone from Docker Hub.
S3_IMAGE='pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372'

webdav_port="${LELAP_TEST_WEBDAV_PORT:-18081}"
s3_port="${LELAP_TEST_S3_PORT:-19190}"
webdav_name='lelap-test-webdav'
s3_name='lelap-test-s3'

down() {
  docker rm --force --volumes "$webdav_name" "$s3_name" > /dev/null 2>&1 || true
}

wait_for() {
  local what="$1" url="$2"
  for _ in $(seq 1 60); do
    # Any HTTP answer will do, a 401 included: the server is listening.
    if curl --silent --output /dev/null --max-time 2 "$url"; then return 0; fi
    sleep 1
  done
  echo "::error::$what did not start within 60 s" >&2
  docker logs "$([ "$what" = WebDAV ] && echo "$webdav_name" || echo "$s3_name")" >&2 || true
  return 1
}

up() {
  down
  docker run --detach --name "$webdav_name" --publish "127.0.0.1:$webdav_port:8080" \
    --tmpfs /data "$WEBDAV_IMAGE" \
    serve webdav /data --addr :8080 --user lelap-test --pass webdav-test-password > /dev/null
  docker run --detach --name "$s3_name" --publish "127.0.0.1:$s3_port:9000" \
    --env MINIO_ROOT_USER=lelap-test --env MINIO_ROOT_PASSWORD=s3-test-password \
    --tmpfs /data "$S3_IMAGE" server /data > /dev/null
  wait_for WebDAV "http://127.0.0.1:$webdav_port/"
  wait_for S3 "http://127.0.0.1:$s3_port/minio/health/ready"
  echo "WebDAV on http://127.0.0.1:$webdav_port/, S3 on http://127.0.0.1:$s3_port"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: scripts/test-servers.sh up|down" >&2; exit 1 ;;
esac
