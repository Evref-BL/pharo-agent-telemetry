# Joining

Participants join a study by running its package, after reading its
participants page: `npx <the study's package> join`. `join`:

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
it received, how many spans of each tool its filter kept, and what it sent
to `state.json`, which `status` shows: a tool whose spans the filter drops
shows there.

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

## Known limits

- Each span's ids are hashed within its session and the week it starts in
  (from Monday 00:00 UTC), so a trace that runs across that instant is cut in
  two: a span started after it hashes its trace and its parent's id in the
  new week, while its parent, started before, was hashed in the old one, and
  the link between them is lost. It is accepted as rare.
