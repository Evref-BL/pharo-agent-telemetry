#!/bin/sh
# Starts the collector. The archive's cap fits this machine, half the free
# space of the archive's disk, unless .env sets ARCHIVE_MAX_MB: past it, new
# spans are refused, and nothing is deleted. The key the collector hashes ids
# with is made anew at each start unless .env sets ID_HASH_KEY; it is never
# written to the archive. Run it again after the disk changes.
set -eu
cd "$(dirname "$0")"
set -a
[ -f .env ] && . ./.env
set +a
archive="${ARCHIVE_DIR:-./archive}"
if [ -z "${ARCHIVE_MAX_MB:-}" ]; then
  free_kb=$(df -Pk "$archive" | awk 'NR == 2 { print $4 }')
  ARCHIVE_MAX_MB=$((free_kb / 2 / 1024))
  [ "$ARCHIVE_MAX_MB" -ge 100 ] || { echo "start.sh: under 200 MB free on $archive's disk" >&2; exit 1; }
  export ARCHIVE_MAX_MB
fi
if [ -z "${ID_HASH_KEY:-}" ]; then
  ID_HASH_KEY=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  export ID_HASH_KEY
fi
case "$ID_HASH_KEY" in
  *[!0-9a-f]*) echo "start.sh: ID_HASH_KEY must be lowercase hex" >&2; exit 1 ;;
esac
[ "${#ID_HASH_KEY}" -ge 32 ] || { echo "start.sh: ID_HASH_KEY must be 32 hex digits or more" >&2; exit 1; }
echo "Archive: new spans refused past $ARCHIVE_MAX_MB MB in $archive"
exec docker compose up -d "$@"
