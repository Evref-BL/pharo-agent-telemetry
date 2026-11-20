// The collector's configuration and the participants page, both made from
// collector/allowlist.json.
import fs from "node:fs";
import path from "node:path";
import { publicEndpoint, publicToken } from "./collector.js";
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

/** A span name that is an operation, optionally followed by one tool or command name: `tools/call class_get`, `plexus.image.make`, `pharo-agent help`. */
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

/**
 * What a participant reads before joining: what is kept, what never is, how
 * long, and how to leave.
 *
 * @param {Allowlist} allowlist
 */
export function participantsPage(allowlist, collector = { endpoint: publicEndpoint, token: publicToken }) {
  const settings = Object.entries(collectorSettings({
    endpoint: collector.endpoint ?? "https://<the collector, once deployed>",
    token: collector.token ?? "TOKEN",
  })).map(([key, value]) => `${key}=${value}`).join("\n").replace("Bearer%20TOKEN", "Bearer%20<its token>");
  const rows = (attributes) => Object.entries(attributes).map(([name, description]) => `| \`${name}\` | ${description} |`).join("\n");
  return `<!-- Generated from collector/allowlist.json by \`npm run generate\`. Do not edit. -->
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
- Host names, user names, email addresses, IP addresses.
- Any identifier of you. There are no participant ids: your data cannot be
  told apart from anyone else's, and there is nothing to delete per person.

The tools enforce this before sending, and the collector again: it keeps only
the attributes listed above, shortens any value to ${longestValue} characters,
replaces a span name that is not an operation and a tool name with \`_OTHER\`, drops
span events and status messages, and masks any value that contains
${Object.keys(allowlist.blockedValues).join(", ")}, whole. It records nothing about the
connection: no address, no headers.

## How long

Raw spans are kept for twelve months. Reports derived from them are kept.

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
	githubUser: 'Evref-BL' project: 'MCP' commitish: 'main' path: 'src';
	baseline: 'MCP';
	load: #( 'default' 'Telemetry' ).
(MCP startOnPort: 4000) useOpenTelemetryObservability
\`\`\`

The image reads the file at every start, so deleting it is leaving, from the
next start on.
`;
}
