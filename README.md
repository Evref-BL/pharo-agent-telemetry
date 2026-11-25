# pharo-agent-telemetry

Run an opt-in study of how agents use the Pharo agent tools (the pharo-agent
plugin, PLexus and Pharo MCP): which tools agents reach, which arguments they
expect, which answers are too long, which mistakes they repair.

The tools speak standard OpenTelemetry and name no collector. This package is
what a study needs around them, and names no study:

- the agent participants install, which keeps only what the study's
  allowlist allows and sends it on;
- the collector it sends to, as Docker Compose, which applies the same rules
  again and serves the signed catalog of names the agents update their
  filter from;
- the commands that make the agent's filter, the collector's configuration
  and the participants page from the study's own data, so the three cannot
  disagree.

## Starting a study

A study is a directory of data, published as an npm package of its own that
participants run with npx. Start one from the complete example this
package's tests run:

```sh
npx @evref-bl/pharo-agent-telemetry init my-study
cd my-study
npx @evref-bl/pharo-agent-telemetry generate   # the filter, the collector's configuration, the participants page
npx @evref-bl/pharo-agent-telemetry check      # the generated files are current and every rule's fixture holds
```

`npx @evref-bl/pharo-agent-telemetry` lists every command. Always name the
package with its scope: the unscoped name is not ours.

## Joining one

Participants read the study's participants page, which `generate` writes to
`docs/participants.md`, then run the study's package:

```sh
npx <the study's package> preview   # what would be sent, sending nothing
npx <the study's package> join      # consent: installs the agent and points the tools at it
npx <the study's package> status
npx <the study's package> leave     # withdraws: removes everything join installed
```

## Documentation

- [Studies](docs/studies.md): a study's files, what is code and what is data, the participants page.
- [Joining](docs/joining.md): what `join` installs and changes, the agent, `preview` and `leave`.
- [The collector](docs/collector.md): what it keeps and logs, deploying it, getting the archive out.
- [Changing what is kept](docs/changing-what-is-kept.md): the allowlist, the catalog of names, and how agents get a new one.

## Development

```sh
npm test    # the example study is current, then every test, the collector's in Docker
```

## Licence

[MIT](LICENSE).
