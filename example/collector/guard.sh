#!/bin/sh
# Says when the archive holds ARCHIVE_MAX_MB or more, by the file
# /guard/full, which makes Caddy refuse new spans: should the import stop,
# the disk does not fill, and no file it has not loaded is deleted.
set -eu
while :; do
  used=$(du -sm /archive | cut -f1)
  if [ "$used" -ge "$ARCHIVE_MAX_MB" ]; then
    touch /guard/full
  else
    rm -f /guard/full
  fi
  sleep "${GUARD_INTERVAL:-30}"
done
