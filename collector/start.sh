#!/bin/sh
# Starts the collector with an archive cap that fits this machine: half the
# free space of the archive's disk, in the 10 MB files the collector rotates,
# unless .env sets ARCHIVE_MAX_FILES. Run it again after the disk changes.
set -eu
cd "$(dirname "$0")"
set -a
[ -f .env ] && . ./.env
set +a
archive="${ARCHIVE_DIR:-./archive}"
if [ -z "${ARCHIVE_MAX_FILES:-}" ]; then
  free_kb=$(df -Pk "$archive" | awk 'NR == 2 { print $4 }')
  ARCHIVE_MAX_FILES=$((free_kb / 2 / 10240))
  [ "$ARCHIVE_MAX_FILES" -ge 10 ] || { echo "start.sh: under 200 MB free on $archive's disk" >&2; exit 1; }
  export ARCHIVE_MAX_FILES
fi
echo "Archive: at most $ARCHIVE_MAX_FILES files of 10 MB in $archive"
exec docker compose up -d "$@"
