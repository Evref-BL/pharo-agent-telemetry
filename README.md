# pharo-agent-telemetry

Field telemetry for the Pharo agent tools: the pharo-agent plugin, PLexus and
Pharo MCP. Usage shapes the tools: which tools agents reach, which arguments
they expect, which answers are too long, which mistakes they repair.

The tools themselves only speak standard OpenTelemetry and name no collector.
This repository is the experiment that uses them:

- `bin/`, `src/`: `npx @evref-bl/pharo-agent-telemetry preview | join | status | leave`.
- `collector/`: the collector participants send to, as Docker Compose.
- `docs/participants.md`: what is sent, generated from the collector's
  allowlist so the page and the filter cannot disagree.

The archive the collector writes is loaded into Elasticsearch by a scheduled
GitLab job, in its own repository (`pharo-agent-telemetry-import`).

## Joining

See [docs/participants.md](docs/participants.md). `join` writes
`~/.config/pharo-agent/otel.env`, which every Pharo tool reads when its
environment configures no OpenTelemetry of its own; `leave` deletes it.

## The collector

Caddy takes HTTPS and passes `POST /v1/traces` on, without the client's
address or headers, and logs no request: neither an access log nor the error
log, which would hold the client's address. Both containers' logs rotate. The OpenTelemetry Collector checks the shared token, keeps
only what [collector/allowlist.json](collector/allowlist.json) allows, and
writes OTLP JSON lines to `archive/traces.jsonl`, rotated every 10 MB.

## Deploying

What only people can decide comes first:

1. The controller and the address participants write to, and the DPO's
   reading of [docs/participants.md](docs/participants.md) and the
   allowlist, which make the GDPR notice for the connection.
2. A VM in the EU with Docker, a DNS name pointing at it, ports 80 and 443
   open, and SSH for the import job. Its provider is the processor the
   notice names.
3. The Elasticsearch keys and the GitLab project of
   `pharo-agent-telemetry-import`, whose README lists them.

Then, on the VM:

```sh
git clone <this repository> /srv/pharo-agent-telemetry
cd /srv/pharo-agent-telemetry/collector
cp .env.example .env            # set SITE_ADDRESS and COLLECTOR_TOKEN
install -d -o 10001 -g 10001 -m 0770 archive
./start.sh
```

`start.sh` caps the archive at half the free space of its disk, so it never
fills the disk should the import stop: past the cap, the oldest files go.
`SAMPLING_PERCENTAGE` in `.env` keeps only that share of the traces, a call's
spans all together; it stays at 100 unless the volume outgrows the import.

From anywhere, check what participants rely on: the token is required,
nothing but `/v1/traces` is served, and a span is taken. The span it sends
says `deployment.environment.name=check`, so a report leaves it out.

```sh
npm run check-deployment -- https://<SITE_ADDRESS> <COLLECTOR_TOKEN>
```

Then set `publicEndpoint`, `publicToken`, `controller` and `host` in
[src/collector.js](src/collector.js), run `npm run generate`, and publish the
package. `join` refuses the project's collector until all four are set, and
the participants page says what is missing until then.

The import job reads the archive over SSH as a user in the archive's group,
and deletes each rotated file once Elasticsearch holds its spans. Its
README says how to set it up.

At any time, `npm run audit -- <archive files>` says what an archive holds,
by tool and span, and fails on anything the allowlist does not allow. On the
VM, without Node:

```sh
docker run --rm -v /srv/pharo-agent-telemetry:/r:ro -w /r node:24-alpine \
  node scripts/audit-archive.js collector/archive/traces.jsonl
```

Locally, `SITE_ADDRESS=http://:80` and `HTTP_PORT=127.0.0.1:4318` serve plain
HTTP on `http://127.0.0.1:4318`.

## Changing what is kept

Edit `collector/allowlist.json`, then `npm run generate`, which rewrites
`collector/otelcol.yaml` and `docs/participants.md`. `npm test` fails while
either is stale, and runs the collector in Docker against a span carrying
everything the allowlist forbids. A tool that starts sending an attribute
needs it here too, or the collector drops it: run a session against a local
collector and `npm run audit` its archive to see what arrives.
