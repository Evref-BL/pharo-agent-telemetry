// The collector's configuration and the participants page, both made from
// collector/allowlist.json.
import fs from "node:fs";
import path from "node:path";
import { controller, host, publicEndpoint, publicToken } from "./collector.js";
import { collectorSettings } from "./settings.js";

/**
 * @typedef {{
 *   resource: Record<string, string>,
 *   span: Record<string, string>,
 *   blockedValues: Record<string, string>,
 * }} Allowlist
 */

/**
 * @param {string} root the repository
 * @returns {Allowlist}
 */
export function readAllowlist(root) {
  const { resource, span, blockedValues } = JSON.parse(fs.readFileSync(path.join(root, "collector", "allowlist.json"), "utf8"));
  return { resource, span, blockedValues };
}

/** A YAML double-quoted string, which takes JSON's escapes. */
const quoted = (text) => JSON.stringify(text);

/** An OTTL list of string literals. */
const ottlList = (names) => `[${names.map(quoted).join(", ")}]`;

/** A span name that is an operation, optionally followed by one tool or command name: `tools/call class_get`, `plexus.image.create`, `pharo-agent help`. */
export const spanNamePattern = "^[A-Za-z0-9_.-]{1,64}(/[A-Za-z0-9_.-]{1,64})?( [A-Za-z0-9_-]{1,64})?$";

/** The longest string value kept; the tools send names and versions, never longer. */
export const longestValue = 256;

/**
 * The OpenTelemetry Collector's configuration: OTLP over HTTP behind the
 * shared token, then the allowlist, then a file archive. Nothing else is
 * kept, and nothing about the connection (address, headers) is.
 *
 * @param {Allowlist} allowlist
 */
export function collectorConfig(allowlist) {
  const ottl = (statement) => `          - ${quoted(statement)}`;
  return `# Generated from allowlist.json by \`npm run generate\`. Do not edit.
extensions:
  bearertokenauth:
    token: \${env:COLLECTOR_TOKEN}
  health_check:
    endpoint: 0.0.0.0:13133

receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        max_request_body_size: 4194304
        include_metadata: false
        auth:
          authenticator: bearertokenauth

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 400
    spike_limit_mib: 100

  # Keeps SAMPLING_PERCENTAGE of the traces, all of 100 unless set. Decided by
  # the trace id, so the plugin's, PLexus's and the image's spans of one call,
  # sent apart, are kept or dropped together.
  probabilistic_sampler:
    mode: hash_seed
    hash_seed: 22
    sampling_percentage: \${env:SAMPLING_PERCENTAGE:-100}

  # Events can carry exception messages and stacks: none is kept.
  filter/events:
    error_mode: ignore
    traces:
      spanevent:
        - "true"

  transform/allowlist:
    error_mode: ignore
    trace_statements:
      - context: resource
        statements:
${ottl(`keep_keys(attributes, ${ottlList(Object.keys(allowlist.resource))})`)}
${ottl(`truncate_all(attributes, ${longestValue})`)}
      - context: scope
        statements:
${ottl("keep_keys(attributes, [])")}
      - context: span
        statements:
${ottl(`keep_keys(attributes, ${ottlList(Object.keys(allowlist.span))})`)}
${ottl(`truncate_all(attributes, ${longestValue})`)}
${ottl('set(status.message, "")')}
${ottl('set(trace_state, "")')}
${ottl(`set(name, "_OTHER") where not IsMatch(name, ${quoted(spanNamePattern)})`)}

  redaction:
    allow_all_keys: true
    blocked_values:
${Object.values(allowlist.blockedValues).map((pattern) => `      - ${quoted(pattern)}`).join("\n")}
    summary: silent

  batch:
    timeout: 5s

exporters:
  file/archive:
    path: /archive/traces.jsonl
    format: json
    flush_interval: 1s
    rotation:
      # ARCHIVE_MAX_FILES rotated files at most, which start.sh sets from the
      # disk's free space: should the import stop, the oldest files go rather
      # than the disk filling.
      max_megabytes: 10
      max_days: 400
      max_backups: \${env:ARCHIVE_MAX_FILES}

service:
  extensions: [bearertokenauth, health_check]
  telemetry:
    logs:
      level: warn
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, probabilistic_sampler, filter/events, transform/allowlist, redaction, batch]
      exporters: [file/archive]
`;
}

/** What the page says where a fact is not settled yet. */
const unsettled = (what) => `*${what}: not set yet. Nobody can join until it is.*`;

/**
 * What a participant reads before joining: what is kept, what never is, who
 * answers for it, on what basis, for how long, their rights, and how to leave.
 * It is the GDPR's notice (Art. 13) for the one moment personal data is
 * processed, the connection, and says why the archive itself is anonymous.
 *
 * @param {Allowlist} allowlist
 */
export function participantsPage(allowlist, collector = { endpoint: publicEndpoint, token: publicToken, controller, host }) {
  const settings = Object.entries(collectorSettings({
    endpoint: collector.endpoint ?? "https://<the collector, once deployed>",
    token: collector.token ?? "TOKEN",
  })).map(([key, value]) => `${key}=${value}`).join("\n").replace("Bearer%20TOKEN", "Bearer%20<its token>");
  const rows = (attributes) => Object.entries(attributes).map(([name, description]) => `| \`${name}\` | ${description} |`).join("\n");
  const who = collector.controller
    ? `${collector.controller.name} decides why and how this data is processed, the GDPR's controller. Write to ${collector.controller.contact} with any question, or to withdraw.`
    : unsettled("The controller and how to reach them");
  const where = collector.host
    ? `The collector runs on a virtual machine at ${collector.host.provider}, in ${collector.host.region}, which processes the data on the controller's behalf. Once a day a job copies what it received to ${collector.host.archive}, and deletes it from the machine.`
    : unsettled("Where the collector runs");
  return `<!-- Generated from collector/allowlist.json and src/collector.js by \`npm run generate\`. Do not edit. -->
# What the Pharo tools send when you join

The Pharo agent tools (the pharo-agent plugin, PLexus and Pharo MCP) can
record how agents use them, so the tools can change to fit that use: tools
nobody reaches, arguments agents expect but the tools do not take, answers
that are too long, mistakes agents repair. Joining is opt-in, and nothing is
sent until you join. The tools never ask you to.

## What is sent

One span per tool call and per component, and one per image operation. A
span says which operation it was, when, how long it took, whether it failed,
and the attributes below. Nothing else reaches the archive: the collector
drops every other attribute before writing anything.

Where it ran:

| Attribute | What it is |
| --- | --- |
${rows(allowlist.resource)}

What happened:

| Attribute | What it is |
| --- | --- |
${rows(allowlist.span)}

## What is never sent

- Argument values, results, source code, prompts, file contents.
- Exception messages and stacks.
- Paths, image names, project names, the names of your classes, methods or
  packages.
- Host names, user names, email addresses.
- Any identifier of you or your machine. There are no participant ids.

The tools enforce this before sending, and the collector again: it keeps only
the attributes listed above, shortens any value to ${longestValue} characters,
replaces a span name that is not an operation and a tool name with \`_OTHER\`, drops
span events, status messages and trace state, and masks any value that contains
${Object.keys(allowlist.blockedValues).join(", ")}, whole.

## Is it anonymous?

The archive is. A session's calls share a \`session.id\`, so the order of
calls within one session can be studied, but a session cannot be linked to
another session, to a machine or to a person, and nothing in a span says who
sent it.

One thing about you does reach the server, as it reaches any server you
connect to: your IP address, so that the connection can be made. The proxy in
front of the collector passes it on to nothing, and writes it nowhere: it
keeps no access log, and its error log, which would hold it, is switched off.
That moment is the only processing of personal data here, and this page is
its notice.

## Who answers for it

${who}

${where}

## Why, and on what basis

To change the tools from how agents use them, rather than from our own
sessions alone. The basis is your consent: running \`join\` after reading this
page gives it, and \`leave\` withdraws it, at any time and with no effect on
what the tools do for you.

## How long

The collector keeps what it receives until the next daily copy, and at most
until half its disk is full. Raw spans are kept twelve months in
Elasticsearch, then deleted. Reports derived from them hold counts, never
spans, and are kept.

## Your rights

You can withdraw at any time with \`leave\`, and nothing is sent from then on.
Access, correction and erasure apply to data about a person; since nothing in
the archive is about one, or can be traced back to one, there is nothing to
look up, correct or delete for you (GDPR Art. 11), and what was sent before
you left stays in the archive, as anonymous as it arrived. You can complain to
your data protection authority; in France, the CNIL (cnil.fr).

## Joining and leaving

\`\`\`sh
npx @evref-bl/pharo-agent-telemetry preview   # see what would be sent, sending nothing
npx @evref-bl/pharo-agent-telemetry join
npx @evref-bl/pharo-agent-telemetry status
npx @evref-bl/pharo-agent-telemetry leave
\`\`\`

\`join\` writes a settings file, \`~/.config/pharo-agent/otel.env\`
(\`%APPDATA%\\pharo-agent\\otel.env\` on Windows), that every Pharo tool reads
when its environment configures no OpenTelemetry of its own. \`leave\` deletes
it. Tools already running keep their settings until they restart, and images
made before joining send nothing until they are made again.

If the collector cannot be reached, the tools stop trying for a while and
never slow down or fail a call because of it.

### With Pharo alone

Using Pharo MCP in your own image, without Node? Joining is the same file,
written by hand or from Pharo. Its content:

\`\`\`text
${settings}
\`\`\`

Then load MCP's \`Telemetry\` group and switch your server to it once:

\`\`\`smalltalk
Metacello new
	githubUser: 'Evref-BL' project: 'MCP' commitish: 'v4.x.x' path: 'src';
	baseline: 'MCP';
	load: #( 'default' 'Telemetry' ).
(MCP startOnPort: 4000) useOpenTelemetryObservability
\`\`\`

The image reads the file at every start, so deleting it is leaving, from the
next start on.
`;
}
