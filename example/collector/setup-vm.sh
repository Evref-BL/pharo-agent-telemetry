#!/bin/sh
# Prepares a fresh Ubuntu 24.04 VM to run the collector, as root, once:
#
#   sudo sh setup-vm.sh '<the import job's SSH public key>'
#
# It installs Docker from Docker's own repository and security updates, lets
# in SSH, HTTP and HTTPS only, makes the archive this directory's compose file
# writes (owned by the collector's user, 10001), and the user the import job
# logs in as, whose key may only rsync that archive: no shell, nothing
# outside it, so the job's COLLECTOR_ARCHIVE is `.`. Run it from the
# collector's directory, where the study's `collector/` was copied; then
# write .env and run ./start.sh. Running it again changes nothing.
set -eu
[ "$(id -u)" -eq 0 ] || { echo "setup-vm.sh: run it as root (sudo)" >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "setup-vm.sh: made for Ubuntu, not ${ID:-this system}" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)
archive="$here/archive"
import_key="${1:-}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl rsync ufw unattended-upgrades

# Docker Engine and its Compose plugin, from Docker's repository.
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker unattended-upgrades

# The archive: written by the collector as 10001, read and emptied by the import job, in its group.
getent group telemetry >/dev/null || groupadd --gid 10001 telemetry
id telemetry >/dev/null 2>&1 || useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin telemetry
install -d -o 10001 -g 10001 -m 0770 "$archive"

# The import job's user: its key runs rsync on the archive alone.
id importer >/dev/null 2>&1 || useradd --create-home --groups telemetry --shell /bin/sh importer
passwd -l importer >/dev/null
install -d -o importer -g importer -m 0700 /home/importer/.ssh
if [ -n "$import_key" ]; then
  case "$import_key" in
    ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*) ;;
    *) echo "setup-vm.sh: '$import_key' is not an SSH public key" >&2; exit 1 ;;
  esac
  printf 'restrict,command="/usr/bin/rrsync %s" %s\n' "$archive" "$import_key" > /home/importer/.ssh/authorized_keys
  chown importer:importer /home/importer/.ssh/authorized_keys
  chmod 0600 /home/importer/.ssh/authorized_keys
fi

# SSH, HTTP for the certificate's challenge, HTTPS; nothing else.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "Ready: Docker $(docker --version | cut -d' ' -f3 | tr -d ,), the archive at $archive, the import job's user importer${import_key:+ with its key}."
echo "Next: cp .env.example .env, set SITE_ADDRESS and COLLECTOR_TOKEN, then ./start.sh"
