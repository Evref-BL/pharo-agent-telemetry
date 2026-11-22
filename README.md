# pharo-agent-telemetry

Field telemetry for the Pharo agent tools: the pharo-agent plugin, PLexus and
Pharo MCP. Usage shapes the tools: which tools agents reach, which arguments
they expect, which answers are too long, which mistakes they repair.

The tools themselves only speak standard OpenTelemetry and name no collector.
This repository is the experiment that uses them:

- `bin/`, `src/`: `npx @evref-bl/pharo-agent-telemetry preview | join | status | leave`,
  and the agent `join` installs.
- `collector/`: the collector participants send to, as Docker Compose.
- `docs/participants.md`: what is sent.

One file, [collector/allowlist.json](collector/allowlist.json), says what is
kept. `npm run generate` makes three things of it: the agent's filter
(`src/telemetry-transform.mjs`), the collector's (`collector/otelcol.yaml`)
and the page, so they cannot disagree.

The archive the collector writes is loaded into Elasticsearch by a scheduled
GitLab job, in its own repository (`pharo-agent-telemetry-import`).

## Joining

See [docs/participants.md](docs/participants.md). `join`:

- copies the agent (`src/agent.js`, dependency-free) and its filter into
  `~/.config/pharo-agent-telemetry/` (`%APPDATA%` on Windows), with
  `agent.json` (its port, the collector and its token) and a key of its own
  that hashes ids and never leaves the machine, both readable by their owner
  only;
- runs it as a service of the user, started at login and again when it fails,
  by an absolute path to node: a LaunchAgent on macOS, a systemd user unit on
  Linux, a scheduled task at logon on Windows;
- writes a marked block of standard `OTEL_*` settings, pointing at the agent
  on 127.0.0.1 and holding no token, into PLexus's settings file
  (`~/.config/plexus/otel.env`, which PLexus passes on to the images it
  starts) and MCP's (`~/.config/pharo-mcp/otel.env`, for an image started
  some other way).

The agent takes OTLP/HTTP JSON from loopback only, answers at once, keeps only
traces and of them only what the filter keeps, and sends that to the collector
over verified TLS, one request at a time from a bounded queue, stopping a
while after each failure. `leave` stops and removes the service, the agent's
files and key, and both blocks, wherever a tool may have read them. `preview`
runs the agent in the foreground with sending off and prints what it would
send. Tests give the command `PHARO_AGENT_TELEMETRY_DRY_RUN`, a file the
service commands are written to instead of run.

## The collector

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

`start.sh` caps the archive at half the free space of its disk
(`ARCHIVE_MAX_MB`), so it never fills the disk should the import stop: past
the cap, the guard container marks the archive full and Caddy refuses new
spans (507) until the import has made room; nothing is lost that was taken.
It also makes `ID_HASH_KEY` at each start unless `.env` sets one: the key is
in the collector's environment only, never in the archive.
`SAMPLING_PERCENTAGE` in `.env` keeps only that share of the traces, a call's
spans all together; it stays at 100 unless the volume outgrows the import.

From anywhere, check what participants rely on: the token is required,
nothing but `/v1/traces` is served, and a span is taken. The span it sends is
of no service of ours, so the collector keeps nothing of it.

```sh
npm run check-deployment -- https://<SITE_ADDRESS> <COLLECTOR_TOKEN>
```

Then set `publicEndpoint`, `publicToken`, `controller`, `dpo` and `host` in
[src/collector.js](src/collector.js), run `npm run generate`, and publish the
package. `join` refuses the project's collector until all are set, and the
participants page says what is missing until then. `npm publish` refuses
(`npm run check-release`) while the page lacks any of them: the DPO's contact
shows as a placeholder until `dpo` is set.

The import job reads the archive over SSH as a user in the archive's group,
loads each finished day's files, and deletes them once Elasticsearch holds
their spans. Its README says how to set it up.

At any time, `npm run audit -- <archive files>` says what an archive holds,
by tool and span, and fails on anything the allowlist does not allow. On the
VM, without Node:

```sh
docker run --rm -v /srv/pharo-agent-telemetry:/r:ro -w /r node:24-alpine \
  sh -c 'node scripts/audit-archive.js collector/archive/traces-*.jsonl'
```

Locally, `SITE_ADDRESS=http://:80` and `HTTP_PORT=127.0.0.1:4318` serve plain
HTTP on `http://127.0.0.1:4318`.

## Changing what is kept

Edit `collector/allowlist.json`, then `npm run generate`, which rewrites
`src/telemetry-transform.mjs`, `collector/otelcol.yaml` and
`docs/participants.md`. `npm test` fails while any is stale. Each rule has a
fixture in `test/fixtures/rules/`, a request and the spans it keeps: the
agent's filter must keep exactly those, and so must the collector, run in
Docker, which also gets a span carrying everything the allowlist forbids. A
tool that starts sending an attribute needs it here too, or both drop it: run
a session with `preview`, or against a local collector and `npm run audit`
its archive, to see what arrives.
