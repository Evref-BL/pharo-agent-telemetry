# Changing what is kept

Edit the study's `allowlist.json`, then `npx @evref-bl/pharo-agent-telemetry generate`,
which rewrites `telemetry-transform.mjs`, `collector/` and
`docs/participants.md`. `npx @evref-bl/pharo-agent-telemetry check` fails while any is
stale. Each rule has a fixture in `rules/`, a request and the spans it keeps:
`check` requires the agent's filter to keep exactly those, and the
collector, run in Docker, too, which also gets a span carrying everything the
allowlist forbids. An allowlist that lists the resource attribute
`pharo_agent_telemetry.filter.version` has the agent stamp each span with
the study's version, in place of any a tool sent, so a span without it was
kept by an older filter. A tool that starts sending an attribute needs it here
too, or both drop it: run a session with `preview`, or against a local
collector and `audit` its archive, to see what arrives.

A name an agent chooses is kept only when it is a published tool's or made
of the vocabulary's words: those of the study's `catalog.json` and of the
allowlist's own `guessed words`. An exception's class is kept only when it
is one MCP can name: MCP names it by its nearest class in Pharo's own
packages or MCP's, which only an image of each Pharo version knows. The
catalog is read from the projects' source, and from such images; for each
release of MCP or PLexus, run, from checkouts of the
releases in use and with the PLexus release in use (its `dist/cli.js`),

```sh
npx @evref-bl/pharo-agent-telemetry exception-names --mcp <MCP> --cli <PLexus CLI> --out <directory>
npx @evref-bl/pharo-agent-telemetry catalog --mcp <MCP> --plexus <PLexus> --exceptions <directory>
npx @evref-bl/pharo-agent-telemetry generate
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
