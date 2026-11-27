# The collector

Caddy takes HTTPS and passes `POST /v1/traces` on, without the client's
address or headers, and logs no request: neither an access log nor the error
log, which would hold the client's address. It reads a request's headers
within 10 s and its body within 30 s. The containers' logs rotate. The
OpenTelemetry Collector checks the shared token, applies the allowlist's rules
again, whatever sent the request, hashes the ids again with `ID_HASH_KEY`, and
writes OTLP JSON lines to one file a day, `archive/traces-YYYY-MM-DD.jsonl`
(the day it received them, UTC), rotated every 10 MB. Nothing in the archive
is ever deleted but by the import.

## Deploying

A study's operators run these commands in its directory (or give
`--study <directory>`), with this package installed there as its
dependency. What only people can decide comes first:

1. Who runs the study and the address participants write to, and what the
   law the study follows asks of them: under the GDPR, for example, the
   DPO's reading of the study's `docs/participants.md` and allowlist, which
   make the notice for the connection.
2. A VM, Ubuntu 24.04, with a DNS name pointing at it and SSH for its
   administrators and the import job, where the study's law lets the data
   be (in the EU, for example, under the GDPR). The participants page names
   its provider and region. 2 vCPU, 2 GB of memory and 20 GB of disk take a study's
   volume many times over.
3. Where the spans go from the archive: a store, and a scheduled job that
   copies the archive over SSH, loads each finished file into it, and
   deletes the file once it is stored.

Then, on the VM:

```sh
git clone <the study's repository> /srv/pharo-agent-telemetry
cd /srv/pharo-agent-telemetry/collector
sudo sh setup-vm.sh '<the import job's SSH public key>'
cp .env.example .env            # set SITE_ADDRESS and COLLECTOR_TOKEN
sudo ./start.sh
```

`setup-vm.sh` installs Docker from Docker's repository and the security
updates, lets in SSH, HTTP and HTTPS only, makes `archive/`, owned by the
collector's user (10001), and the user `importer`, in its group, whose key
may only rsync the archive (`rrsync`): no shell, nothing outside it, so the
import job's `COLLECTOR_ARCHIVE` is `.`. Running it again changes nothing.

`start.sh` caps the archive at half the free space of its disk
(`ARCHIVE_MAX_MB`), so it never fills the disk should the import stop: past
the cap, the guard container marks the archive full and Caddy refuses new
spans (507) until the import has made room; nothing is lost that was taken.
It also makes `ID_HASH_KEY` at each start unless `.env` sets one: the key is
in the collector's environment only, never in the archive. So `docker compose`
refuses any other command without them: `docker ps` and `docker logs
pharo-agent-telemetry-caddy-1` show the stack, and `sudo ./start.sh` restarts it.
`SAMPLING_PERCENTAGE` in `.env` keeps only that share of the traces, a call's
spans all together; it stays at 100 unless the volume outgrows the import.

Caddy also serves `GET /pharo-agent-telemetry/catalog.json` from
`collector/published/` (`PUBLISHED_DIR`): the catalog the agents ask for at
most once a day, signed with the operators' Ed25519 key. Make that key
once, outside the study's directory and outside the VM's checkout if you
can, and sign from the commit you deploy, so that the catalog holds the sets
the collector's configuration was generated from:

```sh
npx @evref-bl/pharo-agent-telemetry sign-catalog --new-key <file outside the study>   # once: prints the public key
npx @evref-bl/pharo-agent-telemetry sign-catalog --key <that file>                    # each deployment
```

From anywhere, check what participants rely on: the token is required,
nothing but `/v1/traces` and the catalog is served, a span is taken, and,
once `catalogPublicKey` is set, the catalog is signed by its key and holds
this checkout's sets. The span it sends is of no service the allowlist lists, so the
collector keeps nothing of it.

```sh
npx @evref-bl/pharo-agent-telemetry check-deployment https://<SITE_ADDRESS> <COLLECTOR_TOKEN>
```

Then set the study's `collector` in `study.json` (`catalogUrl` on the
collector's host), run `npx @evref-bl/pharo-agent-telemetry generate`, and publish the
study's package. `join` refuses the study's collector until all but `dpo`
are set, and the participants page says what is missing until then. The
study's `npm publish` refuses (`pharo-agent-telemetry check-release`) while
the page lacks any of them.

The import job reads the archive over SSH as `importer`, whose key
`setup-vm.sh` locks to rsync of the archive, loads each finished file into
the study's store, and deletes it once stored. A day's file is written until
the day is over (UTC); a file rotated out at 10 MB is complete at once. The
files are OTLP JSON lines, which the OpenTelemetry Collector's
`otlpjsonfile` receiver reads, so the store can be any OpenTelemetry
backend.

At any time, `npx @evref-bl/pharo-agent-telemetry audit <archive files>` says what an
archive holds, by tool and span, and fails on anything the study's allowlist
does not allow. On the VM, without Node installed:

```sh
docker run --rm -v /srv/pharo-agent-telemetry:/r:ro -w /r node:24-alpine \
  sh -c 'npx --yes @evref-bl/pharo-agent-telemetry audit collector/archive/traces-*.jsonl'
```

Locally, `SITE_ADDRESS=http://:80` and `HTTP_PORT=127.0.0.1:4318` serve plain
HTTP on `http://127.0.0.1:4318`.
