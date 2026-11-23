# pharo-agent-telemetry

Run a study of how agents use the Pharo agent tools (the pharo-agent plugin,
PLexus and Pharo MCP): which tools agents reach, which arguments they expect,
which answers are too long, which mistakes they repair.

The tools themselves only speak standard OpenTelemetry and name no collector.
This package is what a study needs around them, and names no study:

- the agent participants install, with `preview`, `join`, `status`, `leave`;
- the collector they send to, as Docker Compose, which also serves the
  signed catalog of names the agents update their filter from;
- the commands that make, from a study's own data, the agent's filter, the
  collector's configuration and the participants page, so they cannot
  disagree, and the other commands its operators run
  (`npx pharo-agent-telemetry` lists them).

The archive a collector writes is loaded into Elasticsearch by a scheduled
GitLab job, in its own repository (`pharo-agent-telemetry-import`).

## A study

A study is a directory, published as an npm package of its own, which
participants run with npx:

- `package.json`: its name, which participants run, and a dependency on this
  package; its `bin` hands the study's directory to this package's commands
  (`import { main } from "@evref-bl/pharo-agent-telemetry/cli"`);
- `study.json`: its `id`, the `page` participants read, its `collector`
  (`endpoint`, `token`, `controller`, `dpo`, `host`, `catalogUrl`,
  `catalogPublicKey`, each `null` until set; [src/study.js](src/study.js)
  says what each is), and the `text` its participants page says of it alone:
  its `purpose`, `why`, `retention` and supervisory `authority`;
- `allowlist.json`, what is kept, with the sets of `catalog.json`: the tools
  MCP, PLexus and pharo-image-fs publish, the words of their own names, and
  the classes MCP names an exception by;
- `rules/`: a fixture per rule, a request and the spans the rules keep of it;
- what `generate` makes of them: `telemetry-transform.mjs`, the filter;
  `collector/`, this package's stack with the study's `otelcol.yaml`; and
  `docs/participants.md`.

[example/](example) is a complete study with no collector set, which this
package's tests run. `npx pharo-agent-telemetry init <directory>` starts a
study from it.

The rules are code, in this package; a study is data, so it runs nothing on
a participant's machine that this package does not ship. A home joins one
study at a time, since the tools read one block of settings: `join` of
another study refuses until `leave`, which any study's package runs.

## Joining

See the study's `docs/participants.md`. `join`:

- copies the agent (`src/agent.js`, dependency-free) and its filter into
  `pharo-agent-telemetry/` under `$XDG_CONFIG_HOME`, `~/.config` or
  `%APPDATA%` on Windows, with `agent.json` (its port, the collector and its
  token, and, for the study's collector, where to ask for a newer catalog
  and the key that signs it) and a key of its own that hashes ids and never
  leaves the machine, both readable by their owner only;
- runs it as a service of the user, started at login and again when it fails,
  by an absolute path to node (the one on `PATH` that outlives an upgrade,
  when there is one): a LaunchAgent on macOS, a systemd user unit on Linux, a
  scheduled task at logon on Windows that runs it with no window. The service
  is named after the agent's directory, and every command acts on a service
  only while that home's definition names it and runs that agent: a command
  run with another `HOME` or `XDG_CONFIG_HOME` never stops or replaces
  another home's agent;
- picks the agent's port below every system's ephemeral range (from 32768 on
  Linux, 49152 on macOS and Windows), where no program is handed it while the
  agent is down;
- writes a marked block of standard `OTEL_*` settings, pointing at the agent
  on 127.0.0.1 and holding no token, into PLexus's settings file
  (`plexus/otel.env`, which PLexus passes on to the images it starts) and
  MCP's (`pharo-mcp/otel.env`, for an image started some other way), under
  `$XDG_CONFIG_HOME` and also under `~/.config` (`%APPDATA%`) when it differs,
  where a tool started from the desktop reads them, through a symbolic link
  into the file it points to. What was the participant's own in a file (the
  whole file, or settings beside an earlier block) is kept as
  `otel.env.before-join`, readable by its owner only, and put back by `leave`.
  Before writing anything, `join` refuses a file it cannot read or write, and
  a backup that no longer holds what the file holds;
- clears PLexus's memory of the agent's endpoint being unreachable, which
  would keep PLexus from sending for hours.

The agent takes OTLP/HTTP JSON from loopback only, answers at once, keeps only
traces and of them only what the filter keeps, and sends that to the collector
over verified TLS, from a bounded queue, the requests waiting merged in one
under the collector's limit. A send that fails is tried once more on a fresh
connection, then sending stops a while; a request the collector refuses stops
nothing. The agent answers `/pharo-agent-telemetry/health` with an HMAC of a
challenge by its key, so `status` tells the agent from another program on its
port, and stops on a request that proves the key, as `preview`, `join` and
`leave` ask (on Windows, ending its task leaves node running). It writes what
it received and sent to `state.json`, which `status` shows.

`join --no-service` installs no service: the agent runs only while
`npx <the study's package> agent` does, as where the service manager
refuses one (over SSH on macOS, on Linux without a systemd user session).

`leave` stops and removes the service, the agent's files and key, and both
blocks, wherever a tool may have read them: it finds the agents this home's
service definitions run, whatever `XDG_CONFIG_HOME` the join saw, and the
settings files beside each, and says where a backup is that it does not put
back. `preview` runs an agent in the foreground with sending off and prints
what it would send; joined, it takes the agent's port while it runs, so the
tools already running show too, answers `status` and `join` as a preview, and
starts the agent again after. A joined preview that is killed leaves
`preview.json` in the agent's directory, and `status` says to join again.

Only the command line reaches the real service manager: `runCommand` runs a
service command only when its environment opts in as the command line does,
outside `node --test`, and when `HOME` is the account's own home (a service
defined under any other home would still run in this account's service
manager). Where it refuses, each command says why in one line, and a join
removes what it installed. Tests give the command
`PHARO_AGENT_TELEMETRY_DRY_RUN`, a file the service commands are written to
instead of run, or `PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS`, a directory of
fake commands run instead of the real ones, which holds
`.pharo-agent-telemetry-fakes`; both are obeyed under `node --test` only.
`leave` and `status` take a directory a service definition names for an
agent's only when it is named `pharo-agent-telemetry` and holds an
`agent.json` of ours.

### Known limits

- Each span's ids are hashed within its session and the week it starts in
  (from Monday 00:00 UTC), so a trace that runs across that instant is cut in
  two: a span started after it hashes its trace and its parent's id in the
  new week, while its parent, started before, was hashed in the old one, and
  the link between them is lost. It is accepted as rare.

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

A study's operators run these commands in its directory (or give
`--study <directory>`), with this package installed there as its
dependency. What only people can decide comes first:

1. The controller and the address participants write to, and the DPO's
   reading of the study's `docs/participants.md` and allowlist, which make
   the GDPR notice for the connection.
2. A VM in the EU with Docker, a DNS name pointing at it, ports 80 and 443
   open, and SSH for the import job. Its provider is the processor the
   notice names.
3. The Elasticsearch keys and the GitLab project of
   `pharo-agent-telemetry-import`, whose README lists them.

Then, on the VM:

```sh
git clone <the study's repository> /srv/pharo-agent-telemetry
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

Caddy also serves `GET /pharo-agent-telemetry/catalog.json` from
`collector/published/` (`PUBLISHED_DIR`): the catalog the agents ask for at
most once a day, signed with the operators' Ed25519 key. Make that key
once, outside the study's directory and outside the VM's checkout if you
can, and sign from the commit you deploy, so that the catalog holds the sets
the collector's configuration was generated from:

```sh
npx pharo-agent-telemetry sign-catalog --new-key <file outside the study>   # once: prints the public key
npx pharo-agent-telemetry sign-catalog --key <that file>                    # each deployment
```

From anywhere, check what participants rely on: the token is required,
nothing but `/v1/traces` and the catalog is served, a span is taken, and,
once `catalogPublicKey` is set, the catalog is signed by its key and holds
this checkout's sets. The span it sends is of no service of ours, so the
collector keeps nothing of it.

```sh
npx pharo-agent-telemetry check-deployment https://<SITE_ADDRESS> <COLLECTOR_TOKEN>
```

Then set the study's `collector` in `study.json` (`catalogUrl` on the
collector's host), run `npx pharo-agent-telemetry generate`, and publish the
study's package. `join` refuses the study's collector until all are set, and
the participants page says what is missing until then. The study's
`npm publish` refuses (`pharo-agent-telemetry check-release`) while the page
lacks any of them: the DPO's contact shows as a placeholder until `dpo` is
set.

The import job reads the archive over SSH as a user in the archive's group,
loads each finished day's files, and deletes them once Elasticsearch holds
their spans. Its README says how to set it up.

At any time, `npx pharo-agent-telemetry audit <archive files>` says what an
archive holds, by tool and span, and fails on anything the study's allowlist
does not allow. On the VM, without Node installed:

```sh
docker run --rm -v /srv/pharo-agent-telemetry:/r:ro -w /r node:24-alpine \
  sh -c 'npx --yes @evref-bl/pharo-agent-telemetry audit collector/archive/traces-*.jsonl'
```

Locally, `SITE_ADDRESS=http://:80` and `HTTP_PORT=127.0.0.1:4318` serve plain
HTTP on `http://127.0.0.1:4318`.

## Changing what is kept

Edit the study's `allowlist.json`, then `npx pharo-agent-telemetry generate`,
which rewrites `telemetry-transform.mjs`, `collector/` and
`docs/participants.md`. `npx pharo-agent-telemetry check` fails while any is
stale. Each rule has a fixture in `rules/`, a request and the spans it keeps:
`check` requires the agent's filter to keep exactly those, and the
collector, run in Docker, too, which also gets a span carrying everything the
allowlist forbids. A tool that starts sending an attribute needs it here
too, or both drop it: run a session with `preview`, or against a local
collector and `audit` its archive, to see what arrives.

A name an agent chooses is kept only when it is a published tool's or made
of the vocabulary's words: those of the study's `catalog.json` and of the
allowlist's own `guessed words`. An exception's class is kept only when it
is one MCP can name: MCP names it by its nearest class in Pharo's own
packages or MCP's, which only an image of each Pharo version knows. The
catalog is read from the projects' source, and from such images; for each
release of MCP, PLexus or pharo-image-fs, run, from checkouts of the
releases in use and with the PLexus release in use (its `dist/cli.js`),

```sh
npx pharo-agent-telemetry exception-names --mcp <MCP> --cli <PLexus CLI> --out <directory>
npx pharo-agent-telemetry catalog --mcp <MCP> --plexus <PLexus> --pharo-image-fs <pharo-image-fs> --exceptions <directory>
npx pharo-agent-telemetry generate
```

`exception-names` has PLexus make an image of each Pharo version MCP's CI
runs, with MCP's Telemetry group, named `exceptions-<version>`, recording
nothing and deleted after, and evaluates `scripts/exception-names.st` in it, which writes the
name MCP's own rule gives every exception class and compiler notice of the
image; it says which version PLexus has no template of, and leaves it out.
`catalog` leaves out a name a catalog could not add, not of a class name's
strict shape, and says so.

Until then, a tool or word the release adds is dropped, or kept as `_OTHER`.
`releases` in the catalog names the commits it was read from, `images` the
images MCP named the exception classes in, and `published` when it was read.

The agents already installed need no new package for it: deployed and
signed again (`sign-catalog`), the catalog reaches them within a day.
An agent sending to its study's collector asks `catalogUrl` for it at most
once a day, and takes it only when its Ed25519 signature holds by
`catalogPublicKey` (never a key of small order, which anyone can sign for),
its form (`schema`) is the one its filter reads, and its date (`published`,
the signing time, `YYYY-MM-DDTHH:MM:SS(.mmm)Z`) is later than the one in use
and no later than tomorrow on the machine's clock; it then filters with it
from the next request on, keeps it in `catalog.json` beside its settings for
its next start, and `status` shows its date, its releases and what it added.
A catalog only adds, and only to the sets the allowlist's `grows` names (the
tools, the words, PLexus's error codes, the exception classes), each member
of its set's strict shape and at most `catalogAdditionCap` a set; any other
member is left out on its own. The agent hosts and the other sets come from
the study's package alone, and the rules stay code, so a catalog never
changes which attributes are kept or in what shape. `sign-catalog` refuses a
catalog the agents would trim, and a date in the future. A change to the
allowlist needs a new package of the study, and a change to the rules, or to
a set's form, a new one of this package and then of the study: raise
`catalogSchema` in `src/rules.js` when the form changes, so that older agents
refuse the catalogs they cannot read. A compromised key is replaced only by
a study's package naming a new one, which participants get by joining
again.
