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
address or headers. The OpenTelemetry Collector checks the shared token, keeps
only what [collector/allowlist.json](collector/allowlist.json) allows, and
writes OTLP JSON lines to `archive/traces.jsonl`, rotated every 10 MB.

On a Debian VM with Docker, a DNS name pointing at it, and ports 80 and 443
open:

```sh
git clone <this repository> /srv/pharo-agent-telemetry
cd /srv/pharo-agent-telemetry/collector
cp .env.example .env            # set SITE_ADDRESS and COLLECTOR_TOKEN
install -d -o 10001 -g 10001 -m 0770 archive
docker compose up -d
```

Then set `publicEndpoint` and `publicToken` in [src/collector.js](src/collector.js)
and publish the package.

The import job reads the archive over SSH as a user in the archive's group,
and deletes each rotated file once Elasticsearch holds its spans.

Locally, `SITE_ADDRESS=http://:80` and `HTTP_PORT=127.0.0.1:4318` serve plain
HTTP on `http://127.0.0.1:4318`.

## Changing what is kept

Edit `collector/allowlist.json`, then `npm run generate`, which rewrites
`collector/otelcol.yaml` and `docs/participants.md`. `npm test` fails while
either is stale, and runs the collector in Docker against a span carrying
everything the allowlist forbids.
