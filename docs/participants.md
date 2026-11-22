<!-- Generated from collector/allowlist.json and src/collector.js by `npm run generate`. Do not edit. -->
# What the Pharo tools send when you join

The Pharo agent tools (the pharo-agent plugin, PLexus and Pharo MCP) can
record how agents use them, so the tools can change to fit that use: tools
nobody reaches, arguments agents expect but the tools do not take, answers
that are too long, mistakes agents repair. Joining is opt-in, and nothing is
sent until you join. The tools never ask you to.

## How it leaves your machine

Only through the agent `join` installs: a small program that runs as a
service of your user account, listens on a port of your own machine
(127.0.0.1), takes what the tools send it, keeps only what this page lists,
and sends that to the collector. The tools' settings point them at the agent
and hold no token: the agent alone knows the collector. It works the same
whether MCP runs alone, under PLexus or under the pharo-agent plugin: PLexus,
the images it starts and an image you start yourself all send to the agent.

The collector applies the same rules again to whatever arrives, and drops
what they do not keep. Both are made from one list, and so is this page.

## What is kept

Only PLexus's and MCP's spans: a span is kept when the tool that sent it is
`plexus` or `pharo-mcp`, its instrumentation scope is that tool's own
(`@evref-bl/plexus`, `mcp-pharo`), and it is one of the operations they record:
`tools/call <tool>`, `tools/list`, `plexus.image.create`, `plexus.image.start`, `plexus.image.stop`, `plexus.image.delete`. Any other span is dropped whole, such as one your own
OpenTelemetry code makes in an image, and so is a span that has links.
Metrics and logs are not kept at all.

Of each span, only this is kept:

- its operation, `tools/call` followed by the tool's name when the attributes
  below keep it;
- its kind (server, client, internal) and its status (unset, ok, error), never
  a status message;
- its trace, span and parent ids, each replaced by a keyed hash: by the agent,
  with a key `join` makes and that never leaves your machine, then again at
  the collector, with a key of its own that never enters the archive. A
  call's spans still group, but nothing joins them to anything else;
- its start time, to the week (the Monday it falls in, at midnight UTC), its
  end time set to the same, and how long it took, as `span.duration_ms`;
- the attributes below, from the tools named, each only in the shape given: a
  value of any other shape is dropped, or replaced as the table says.

Never its events, links, trace state or status message, nor its scope's
attributes. Any value that contains a home directory path, an email address, an IPv4 address, an IPv6 address is
masked, whole, and the mask has no attribute's shape.

Tool and argument names (`gen_ai.tool.name`, `plexus.argument.names`, `plexus.argument.unknown_names`, `pharo.mcp.argument.names`, `pharo.mcp.argument.unknown_names`, `pharo.mcp.argument.coerced`, `pharo.mcp.argument.options`, `pharo.mcp.tool.refs`, `pharo.mcp.error.schema.paths`) are kept only for MCP's own tools and for
names no tool has (`pharo.mcp.tool.origin` `mcp` or `unknown`). For a
tool another package added to an image (`other`, or no origin), the tool's
name becomes `_OTHER` and the other names are dropped. PLexus names only its
own tools: on a call PLexus passes on to an image, its span keeps neither the
tool's name nor its arguments', which the image's span reports as above.

Where it ran:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
| `service.name` | plexus, pharo-mcp | Which tool sent the span. | one of `plexus`, `pharo-mcp` |
| `service.version` | plexus, pharo-mcp | That tool's version. | a version |
| `telemetry.sdk.version` | plexus, pharo-mcp | The OpenTelemetry SDK's version. | a version |
| `os.type` | plexus, pharo-mcp | The OS family. | one of the OS types |
| `process.runtime.name` | plexus, pharo-mcp | nodejs or pharo. | one of `nodejs`, `pharo` |
| `process.runtime.version` | plexus, pharo-mcp | Node's major version, or Pharo's version without its build. | a version |
| `process.runtime.description` | pharo-mcp | The Pharo VM's release, nothing else of its description. | a version |
| `deployment.environment.name` | plexus, pharo-mcp | field for participants, eval for our own evaluation runs, preview while previewing, check for npm run check-deployment. | one of `field`, `eval`, `preview`, `check` |

What happened:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
| `session.id` | plexus, pharo-mcp | Groups the calls of one working session. The tools make it at random for each session; it is replaced by its keyed hash before it leaves your machine. | its keyed hash |
| `mcp.method.name` | plexus, pharo-mcp | The MCP method. | one of `tools/call`, `tools/list` |
| `mcp.protocol.version` | plexus, pharo-mcp | The MCP protocol version, a date. | a date |
| `gen_ai.tool.name` | plexus, pharo-mcp | The tool's name, including a name the agent asked for that no tool has. | an identifier, else `_OTHER` |
| `error.type` | plexus, pharo-mcp | How a call failed: tool_error, a JSON-RPC or HTTP code, how a connection failed, a PLexus error code, or an exception class of Pharo, MCP or Node. | one of `tool_error`, `_OTHER`, `timeout`, `refused`, `closed`, `cancelled`, `invalid-name`, `no-such-image`, `image-exists`, `image-running`, `being-started`, `building`, `not-running`, `starting`, `no-endpoint`, `unknown-template`, `ambiguous-template`, `script-not-found`, `create-failed`, `start-failed`, `stop-failed`, `save-failed`, `stopped-unsaved`, `launcher-failed`, `invalid-arguments`, `no-image-running`, `several-images`, `none-takes-calls`, `Abort`, `ArgumentsCountMismatch`, `ArithmeticError`, `AssertionFailure`, `BlockCannotReturn`, `CannotReturn`, `CollectionIsEmpty`, `ConfirmationRequest`, `ContextCannotReturn`, `DomainError`, `DuplicatedSlotName`, `DuplicatedVariableError`, `Error`, `Exception`, `ExtensionConflictError`, `IllegalResumeAttempt`, `IncompatibleLayoutConflict`, `InformativeNotification`, `InstanceVariableNotFound`, `InvalidSlotName`, `KeyNotFound`, `MessageNotUnderstood`, `ModificationForbidden`, `NewUndeclaredWarning`, `NonBooleanReceiver`, `NotFound`, `NotYetImplemented`, `Notification`, `OutOfMemory`, `PackageConflictError`, `PrimitiveFailed`, `ProcessAlreadyTerminating`, `SelectorException`, `ShouldBeImplemented`, `ShouldNotImplement`, `SimulationExceptionWrapper`, `SizeMismatch`, `SlotNotFound`, `SubclassResponsibility`, `SubscriptOutOfBounds`, `SystemNotification`, `TimedOut`, `UndeclaredVariableError`, `UndeclaredVariableRead`, `UndeclaredVariableWrite`, `UnhandledError`, `UnhandledException`, `UnwindError`, `ValueNotFound`, `Warning`, `ZeroDivide`, `MCPCommandError`, `MCPHeaderMismatch`, `MCPResourceNotFound`, `MCPSyntaxError`, `MCPUnsupportedProtocolVersion`, `MCPInvalidToolInput`, `MCPMissingPromptArgument`, `MCPUnknownCompletionReference`, `MCPUnknownPrompt`, `AbortError`, `AggregateError`, `EvalError`, `RangeError`, `ReferenceError`, `SyntaxError`, `SystemError`, `TimeoutError`, `TypeError`, `URIError`, or a numeric code, else `_OTHER` |
| `plexus.client.name` | plexus | The agent host's name as it introduces itself to PLexus's server, for example claude-code. | a product's name |
| `plexus.client.version` | plexus | The agent host's version, major and minor. | a version |
| `plexus.call.index` | plexus | Where the call comes in its session: 1 for the first. | a whole number from 1 |
| `plexus.call.forwarded` | plexus | Whether PLexus passed the call on to an image, which then names the tool. | true or false |
| `plexus.argument.names` | plexus | The names of the arguments a call to one of PLexus's own tools gave, never their values. | a list of at most 32, each an identifier |
| `plexus.argument.unknown_names` | plexus | Argument names a call gave that PLexus's own tool does not take. | a list of at most 32, each an identifier |
| `plexus.error.code` | plexus | Why PLexus refused a call before any image saw it. | one of the PLexus error codes, else `_OTHER` |
| `plexus.image.save` | plexus | Whether stopping an image saved it. | true or false |
| `pharo.mcp.tool.origin` | pharo-mcp | mcp for one of MCP's own tools, other for a tool another package added, unknown for a name no tool has. Names are kept only for mcp and unknown. | one of `mcp`, `other`, `unknown`, else `other` |
| `pharo.mcp.dispatch_path` | pharo-mcp | How the image dispatched the request. | one of `direct`, `via_tool_call` |
| `pharo.mcp.argument.names` | pharo-mcp | The names of the arguments the image received, never their values. | a list of at most 32, each an identifier |
| `pharo.mcp.argument.unknown_names` | pharo-mcp | Argument names the tool does not declare. | a list of at most 32, each an identifier |
| `pharo.mcp.argument.coerced` | pharo-mcp | Argument names whose values the tool accepted in another form than its schema says. | a list of at most 32, each an identifier |
| `pharo.mcp.argument.options` | pharo-mcp | The options the call chose, as the evaluations count them: a property, a value of an enumeration, or a list given for several targets. | a list of at most 32, each an option |
| `pharo.mcp.input.bytes` | pharo-mcp | The size of the arguments. | a whole number from 0 |
| `pharo.mcp.output.bytes` | pharo-mcp | The size of the answer. | a whole number from 0 |
| `pharo.mcp.result.count` | pharo-mcp | How many results a search answered. | the lower bound of its bucket: 0, 1, 2, 6, 21, 101 |
| `pharo.mcp.result.more` | pharo-mcp | Whether there were more results than answered. | true or false |
| `pharo.mcp.test.outcome` | pharo-mcp | How a test run ended. | one of `passed`, `failed`, `errored` |
| `pharo.mcp.test.count` | pharo-mcp | How many tests ran. | the lower bound of its bucket: 0, 1, 2, 6, 21, 101 |
| `pharo.mcp.tool.refs` | pharo-mcp | The tools a discovery call (tool_search, tool_get) named. | a list of at most 16, each an identifier |
| `pharo.mcp.error.kind` | pharo-mcp | The kind of error MCP reported. | one of `input_schema`, `domain`, `tool_result`, `json_rpc`, `exception` |
| `pharo.mcp.error.code` | pharo-mcp | MCP's own error code. | an identifier |
| `pharo.mcp.error.schema.violation_count` | pharo-mcp | How many schema rules the arguments broke. | a whole number from 0 |
| `pharo.mcp.error.schema.keywords` | pharo-mcp | Which schema rules they broke. | a list of at most 8, each one of the schema keywords |
| `pharo.mcp.error.schema.paths` | pharo-mcp | Where in the tool's input they broke them. | a list of at most 8, each a JSON pointer |
| `pharo.mcp.exception.type` | pharo-mcp | The nearest Pharo or MCP class of an exception. | one of the exception classes, else `_OTHER` |
| `span.duration_ms` | plexus, pharo-mcp | How long the span took, in milliseconds, kept since its times are not. | a number |

## What is never sent

- Argument values, results, source code, prompts, file contents.
- Exception messages and stacks.
- Paths, image names, project names, the names of your classes, methods or
  packages, the names of tools other packages add or of their arguments.
- Host names, user names, email addresses, IP addresses.
- Any identifier of you or your machine. There are no participant ids.
- Precise times: only the week, and how long each span took.

## Is it anonymous?

The archive is. A session's calls share a hashed `session.id`, so the
order of calls within one session can be studied, but a session cannot be
linked to another session, to a machine or to a person, and nothing in a span
says who sent it.

One thing about you does reach the server, as it reaches any server you
connect to: your IP address, so that the connection can be made. The proxy in
front of the collector passes it on to nothing, and writes it nowhere: it
keeps no access log, and its error log, which would hold it, is switched off.
That moment is the only processing of personal data here, and this page is
its notice.

## Who answers for it

*The controller and how to reach them: not set yet. Nobody can join until it is.* Its data protection officer can be reached at **[DPO CONTACT: TO BE FILLED IN src/collector.js BEFORE PUBLISHING]**.

## Who else holds it

*Where the collector runs, the GitLab that copies its archive, and where the archive is kept: not set yet. Nobody can join until it is.*

Nobody else receives it.

## Why, and on what basis

To change the tools from how agents use them, rather than from our own
sessions alone. The basis is your consent: running `join` after reading this
page gives it, and `leave` withdraws it, at any time and with no effect on
what the tools do for you.

## How long

The collector writes what arrives into one file a day, and never deletes a
file the daily import has not loaded; the import deletes each file once
Elasticsearch holds its spans. Should the import stop, the collector refuses
new spans once its archive takes half its disk's free space, rather than
delete any. Elasticsearch keeps the spans in one index a month, and deletes
each index twelve months after it was made. Reports derived from them hold
counts, never spans, and are kept.

## Your rights

You can withdraw at any time with `leave`, and nothing is sent from then on.
Access, correction and erasure apply to data about a person; since nothing in
the archive is about one, or can be traced back to one, there is nothing to
look up, correct or delete for you (GDPR Art. 11), and what was sent before
you left stays in the archive, as anonymous as it arrived. You can complain to
your data protection authority; in France, the CNIL (cnil.fr).

## Joining and leaving

With Node 22.15 or later:

```sh
npx @evref-bl/pharo-agent-telemetry preview   # see what would be sent, sending nothing
npx @evref-bl/pharo-agent-telemetry join
npx @evref-bl/pharo-agent-telemetry status
npx @evref-bl/pharo-agent-telemetry leave
```

`join` copies the agent into `~/.config/pharo-agent-telemetry/`
(`%APPDATA%\pharo-agent-telemetry\` on Windows), with its key, and runs it
as a service that starts when you log in and again if it fails: a LaunchAgent
on macOS, a systemd user unit on Linux, a scheduled task on Windows. Then it
writes a block of settings, between two marked lines, in PLexus's settings
file, `~/.config/plexus/otel.env`, and in MCP's, `~/.config/pharo-mcp/otel.env`
(under `%APPDATA%` on Windows):

```text
# pharo-agent-telemetry: joined. Run `npx @evref-bl/pharo-agent-telemetry leave`, or delete these lines down to the end line, to stop.
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<its port>
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_TRACES_EXPORTER=otlp
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=field
# pharo-agent-telemetry: end
```

PLexus reads its file when its environment configures no OpenTelemetry of its
own, and passes it on to the images it starts; an image reads MCP's at every
start. Tools already running start sending once they restart, and images made
before joining send nothing until they are made again.

`preview` runs the agent in the foreground with sending off, points the
tools at it until you stop it, and prints what it would send.

`leave` stops and removes the agent, its files and its key, and both blocks,
wherever the settings may be. Sending stops at once: PLexus and the images
then find the agent's port closed, and nothing else leaves your machine.
Images keep running.

If the collector cannot be reached, the agent stops trying for a while; the
tools never slow down or fail a call because of it.

### With MCP alone

Using Pharo MCP in your own image, without PLexus? Join as above, then load
MCP's `Telemetry` group with the others you use, and switch your server to
it once:

```smalltalk
Metacello new
   baseline: 'MCP';
   repository: 'github://Evref-BL/MCP:v4.x.x/src';
   onConflictUseIncoming;
   load: #( 'default' 'Telemetry' ).
(MCP startOnPort: 4000) useOpenTelemetryObservability
```

The image reads MCP's settings file at every start, so it sends to the agent
from its next start on.
