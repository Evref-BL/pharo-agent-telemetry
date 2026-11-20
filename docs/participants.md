<!-- Generated from collector/allowlist.json by `npm run generate`. Do not edit. -->
# What the Pharo tools send when you join

The Pharo agent tools (the pharo-agent plugin, PLexus and Pharo MCP) can
record how agents use them, so the tools can change to fit that use: tools
nobody reaches, arguments agents expect but the tools do not take, answers
that are too long, mistakes agents repair. Joining is opt-in, and nothing is
sent until you join.

## What is sent

One span per tool call and per component, and one per image operation. A
span says which operation it was, when, how long it took, whether it failed,
and the attributes below. Nothing else reaches the archive: the collector
drops every other attribute before writing anything.

Where it ran:

| Attribute | What it is |
| --- | --- |
| `service.name` | Which tool sent the span: pharo-agent, plexus or pharo-mcp. |
| `service.version` | That tool's version. |
| `telemetry.sdk.name` | The OpenTelemetry SDK that sent it. |
| `telemetry.sdk.language` | The SDK's language: nodejs or pharo. |
| `telemetry.sdk.version` | The SDK's version. |
| `os.type` | The OS family: linux, darwin or windows. |
| `process.runtime.name` | nodejs or pharo. |
| `process.runtime.version` | Node's version, or Pharo's version and build. |
| `process.runtime.description` | The Pharo VM's build. |
| `deployment.environment.name` | field for participants, eval for our own evaluation runs. |
| `pharo_agent.agent_host` | The agent host the project was set up for: claude or codex. |

What happened:

| Attribute | What it is |
| --- | --- |
| `session.id` | A random value that groups the calls of one working session. Renewed after thirty idle minutes; never tied to a person. |
| `mcp.method.name` | The MCP method: tools/call, tools/list, ... |
| `mcp.protocol.version` | The MCP protocol version, a date. |
| `mcp.session.id` | The random id the image's MCP server gives its connection. |
| `gen_ai.operation.name` | execute_tool for a tool call. |
| `gen_ai.tool.name` | The tool's name, when it reads as an identifier. |
| `error.type` | How a call failed: tool_error, a JSON-RPC code, or a class from Pharo, MCP or Node. |
| `network.transport` | pipe or tcp. |
| `network.protocol.name` | http. |
| `pharo_agent.argument.names` | The names of the arguments a call gave, never their values. |
| `pharo_agent.argument.unknown_names` | Argument names the CLI refused. |
| `pharo_agent.client.name` | The agent host's name as it introduces itself, for example claude-code. |
| `pharo_agent.client.version` | The agent host's version. |
| `plexus.image.from_base` | Whether a new image was copied from a prepared base. |
| `plexus.image.save` | Whether stopping an image saved it. |
| `pharo.mcp.dispatch_path` | How the image dispatched the request. |
| `pharo.mcp.argument.names` | The names of the arguments the image received, never their values. |
| `pharo.mcp.argument.unknown_names` | Argument names the tool does not declare. |
| `pharo.mcp.input.bytes` | The size of the arguments. |
| `pharo.mcp.output.bytes` | The size of the answer. |
| `pharo.mcp.output_budget.exceeded` | Whether the answer was longer than the budget. |
| `pharo.mcp.error.kind` | The kind of error MCP reported. |
| `pharo.mcp.error.code` | MCP's own error code. |
| `pharo.mcp.error.schema.violation_count` | How many schema rules the arguments broke. |
| `pharo.mcp.exception.type` | The nearest Pharo or MCP class of an exception. |

## What is never sent

- Argument values, results, source code, prompts, file contents.
- Exception messages and stacks.
- Paths, image names, project names, the names of your classes, methods or
  packages.
- Host names, user names, email addresses, IP addresses.
- Any identifier of you. There are no participant ids: your data cannot be
  told apart from anyone else's, and there is nothing to delete per person.

The tools enforce this before sending, and the collector again: it keeps only
the attributes listed above, shortens any value to 256 characters,
replaces a span name that is not an operation and a tool name with `_OTHER`, drops
span events and status messages, and masks any value that contains
a home directory path, an email address, an IPv4 address, whole. It records nothing about the
connection: no address, no headers.

## How long

Raw spans are kept for twelve months. Reports derived from them are kept.

## Joining and leaving

```sh
npx @evref-bl/pharo-agent-telemetry preview   # see what would be sent, sending nothing
npx @evref-bl/pharo-agent-telemetry join
npx @evref-bl/pharo-agent-telemetry status
npx @evref-bl/pharo-agent-telemetry leave
```

`join` writes a settings file, `~/.config/pharo-agent/otel.env`
(`%APPDATA%\pharo-agent\otel.env` on Windows), that every Pharo tool reads
when its environment configures no OpenTelemetry of its own. `leave` deletes
it. Tools already running keep their settings until they restart, and images
made before joining send nothing until they are made again.

If the collector cannot be reached, the tools stop trying for a while and
never slow down or fail a call because of it.

### With Pharo alone

Using Pharo MCP in your own image, without Node? Joining is the same file,
written by hand or from Pharo. Its content:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=https://<the collector, once deployed>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20<its token>
OTEL_TRACES_EXPORTER=otlp
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=field
```

Then load MCP's `Telemetry` group and switch your server to it once:

```smalltalk
Metacello new
	githubUser: 'Evref-BL' project: 'MCP' commitish: 'main' path: 'src';
	baseline: 'MCP';
	load: #( 'default' 'Telemetry' ).
(MCP startOnPort: 4000) useOpenTelemetryObservability
```

The image reads the file at every start, so deleting it is leaving, from the
next start on.
