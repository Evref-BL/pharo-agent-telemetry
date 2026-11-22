// What `npm run generate` writes from collector/allowlist.json: the filter
// `join` installs on a participant's machine, the collector's configuration,
// which applies the same rules again in OTTL, and the participants page.
import fs from "node:fs";
import path from "node:path";
import { controller, dpo, host, publicEndpoint, publicToken } from "./collector.js";
import { compile, masked, toolCall } from "./rules.js";
import { keyFile } from "./install.js";
import { agentSettings, settingsBlock } from "./settings.js";

/** @typedef {any} Allowlist collector/allowlist.json */

/**
 * @param {string} root the repository
 * @returns {Allowlist}
 */
export function readAllowlist(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "collector", "allowlist.json"), "utf8"));
}

/** A YAML double-quoted string, which takes JSON's escapes; an OTTL string literal too. */
const quoted = (text) => JSON.stringify(text);

/** An OTTL list of string literals. */
const ottlList = (names) => `[${names.map(quoted).join(", ")}]`;

/** The collector's key, from its environment: it hashes ids again, and never enters the archive. */
const keyVariable = "${env:ID_HASH_KEY}";

/**
 * A list whose elements each have the element pattern, as the JSON text
 * OTTL's String() makes of it. Its length is checked apart: RE2 refuses a
 * counted repetition of a pattern that counts its own.
 */
function listPattern(elementPattern) {
  const element = `"(?:${elementPattern.replace(/^\^/, "").replace(/\$$/, "")})"`;
  return `^\\[(?:${element}(?:,${element})*)?\\]$`;
}

const ottlTypes = { string: "IsString", int: "IsInt", bool: "IsBool", double: "IsDouble", "string[]": "IsList" };

/**
 * The OTTL statements that apply one attribute's rules, in the order
 * src/rules.js applies them.
 *
 * @param {ReturnType<typeof compile>} rules
 * @param {any} spec a compiled attribute
 * @param {string} service the path of the service's name in this context
 */
function attributeStatements(rules, spec, service) {
  const at = `attributes[${quoted(spec.key)}]`;
  const drop = (condition) => `delete_key(attributes, ${quoted(spec.key)}) where ${condition}`;
  const isService = (names) => (names.length === 1 ? `${service} == ${quoted(names[0])}` : `IsMatch(${service}, ${quoted(`^(?:${names.join("|")})$`)})`);
  const statements = [];
  if (spec.from) statements.push(drop(`not ${isService(spec.from)}`));
  if (spec.type === "double") statements.push(`set(${at}, Double(${at})) where IsInt(${at})`);
  // An empty value reads as nil: `!= nil` would let it through.
  statements.push(drop(`not ${ottlTypes[spec.type]}(${at})`));
  if (!spec.hash && spec.type === "string") {
    for (const { pattern } of rules.blocked) statements.push(`set(${at}, ${quoted(masked)}) where IsString(${at}) and IsMatch(${at}, ${quoted(pattern)})`);
  }
  if (spec.extract) {
    for (const [name, pattern] of Object.entries(spec.extract)) {
      statements.push(`replace_pattern(${at}, ${quoted(pattern)}, "$$1") where IsString(${at})${name === "*" ? "" : ` and ${service} == ${quoted(name)}`}`);
    }
    if (!("*" in spec.extract)) statements.push(drop(`${at} != nil and not ${isService(Object.keys(spec.extract))}`));
  }
  if (spec.type === "string[]") {
    for (const { pattern } of rules.blocked) statements.push(drop(`IsList(${at}) and IsMatch(String(${at}), ${quoted(pattern)})`));
  }
  if (spec.type === "string" && spec.pattern) {
    const mismatch = `IsString(${at}) and not IsMatch(${at}, ${quoted(spec.pattern)})`;
    statements.push(spec.otherwise === undefined ? drop(mismatch) : `set(${at}, ${quoted(spec.otherwise)}) where ${mismatch}`);
  }
  if (spec.type === "int" && spec.min !== undefined) statements.push(drop(`IsInt(${at}) and ${at} < ${spec.min}`));
  if (spec.type === "int" && spec.buckets) {
    const bounds = spec.buckets;
    statements.push(drop(`IsInt(${at}) and ${at} < ${bounds[0]}`));
    bounds.forEach((bound, index) => {
      const next = bounds[index + 1];
      statements.push(`set(${at}, ${bound}) where IsInt(${at}) and ${at} >= ${bound}${next === undefined ? "" : ` and ${at} < ${next}`}`);
    });
  }
  if (spec.type === "double" && spec.min !== undefined) statements.push(drop(`IsDouble(${at}) and ${at} < ${Number(spec.min).toFixed(1)}`));
  if (spec.type === "string[]") {
    statements.push(drop(`IsList(${at}) and Len(${at}) > ${spec.max}`));
    statements.push(drop(`IsList(${at}) and not IsMatch(String(${at}), ${quoted(listPattern(spec.pattern))})`));
  }
  if (spec.default !== undefined) statements.push(`set(${at}, ${quoted(spec.default)}) where ${at} == nil${spec.from ? ` and ${isService(spec.from)}` : ""}`);
  if (spec.hash) statements.push(`set(${at}, Substring(SHA256(Concat([${quoted(keyVariable)}, ${quoted(spec.hash)}, ${at}], ":")), 0, 32)) where IsString(${at})`);
  return statements;
}

/** The conditions that drop a span whole: not one of ours, links, an attribute given twice, malformed. */
export function dropConditions(rules) {
  const ours = Object.entries(rules.services).map(([service, { scope, namePattern }]) =>
    `(resource.attributes["service.name"] == ${quoted(service)} and instrumentation_scope.name == ${quoted(scope)} and IsMatch(name, ${quoted(namePattern)}))`);
  return [
    `not (${ours.join(" or ")})`,
    "Len(links) > 0",
    "Len(ParseJSON(String(attributes))) != Len(attributes)",
    'Len(ParseJSON(String(resource.attributes))) != Len(resource.attributes)',
    'IsMatch(trace_id.string, "^0+$") or IsMatch(span_id.string, "^0+$")',
    // From 2^63 a time reads as negative: past 2262 a start is under the floor and an end under its start.
    "start_time_unix_nano < 345600000000000 or end_time_unix_nano < start_time_unix_nano",
    "kind < 0 or kind > 5",
    "status.code < 0 or status.code > 2",
  ];
}

/** The OTTL statements of each context, in the order src/rules.js applies the same rules. */
export function ruleStatements(allowlist) {
  const rules = compile(allowlist);
  const resourceService = 'attributes["service.name"]';
  const spanService = 'resource.attributes["service.name"]';
  const resource = [
    `keep_keys(attributes, ${ottlList(rules.resource.map((spec) => spec.key))})`,
    ...rules.resource.flatMap((spec) => attributeStatements(rules, spec, resourceService)),
    'set(schema_url, "")',
    "set(dropped_attributes_count, 0)",
    // The day it arrived, for the archive's daily file alone: the import never keeps it.
    'set(attributes["fileexporter.path_segment"], FormatTime(Now(), "%Y-%m-%d"))',
  ];
  const scope = [
    "keep_keys(attributes, [])",
    `set(version, "") where not IsMatch(version, ${quoted(rules.versionPattern)})`,
    'set(schema_url, "")',
    "set(dropped_attributes_count, 0)",
  ];
  const names = rules.span.filter((spec) => spec.name);
  const origin = rules.span.find((spec) => spec.key === "pharo.mcp.tool.origin");
  const isOther = `${spanService} == ${quoted(origin.from[0])} and attributes["pharo.mcp.tool.origin"] == "other"`;
  const forwarded = Object.entries(rules.services).filter(([, { tools }]) => tools).map(([service, { toolPattern }]) =>
    `${spanService} == ${quoted(service)} and (attributes["plexus.call.forwarded"] == true or kind == SPAN_KIND_CLIENT or (attributes["gen_ai.tool.name"] != nil and not IsMatch(attributes["gen_ai.tool.name"], ${quoted(toolPattern)})))`);
  // The tool's name decides whether a span forwarded the call: dropped last.
  const byToolLast = [...names].sort((a, b) => Number(a.key === "gen_ai.tool.name") - Number(b.key === "gen_ai.tool.name"));
  const span = [
    `keep_keys(attributes, ${ottlList(rules.span.map((spec) => spec.key))})`,
    ...rules.span.flatMap((spec) => attributeStatements(rules, spec, spanService)),
    ...names.map((spec) => {
      const at = `attributes[${quoted(spec.key)}]`;
      return spec.nameOther === undefined
        ? `delete_key(attributes, ${quoted(spec.key)}) where ${isOther}`
        : `set(${at}, ${quoted(spec.nameOther)}) where ${isOther} and ${at} != nil`;
    }),
    ...forwarded.flatMap((condition) => byToolLast.map((spec) => `delete_key(attributes, ${quoted(spec.key)}) where ${condition}`)),
    `set(name, Concat([${quoted(toolCall)}, attributes["gen_ai.tool.name"]], " ")) where IsMatch(name, ${quoted(`^${toolCall}(?: [\\s\\S]*)?$`)}) and IsString(attributes["gen_ai.tool.name"])`,
    `set(name, ${quoted(toolCall)}) where IsMatch(name, ${quoted(`^${toolCall} `)}) and attributes["gen_ai.tool.name"] == nil`,
    'set(attributes["span.duration_ms"], Double(Microseconds(end_time - start_time)) / 1000.0) where end_time_unix_nano > start_time_unix_nano',
    'set(attributes["span.duration_ms"], 0.0) where attributes["span.duration_ms"] == nil',
    'set(start_time, TruncateTime(start_time, Duration("168h")))',
    "set(end_time, start_time)",
    `set(trace_id.string, Substring(SHA256(Concat([${quoted(keyVariable)}, "trace", trace_id.string], ":")), 0, 32))`,
    `set(span_id.string, Substring(SHA256(Concat([${quoted(keyVariable)}, "span", span_id.string], ":")), 0, 16))`,
    `set(parent_span_id.string, Substring(SHA256(Concat([${quoted(keyVariable)}, "span", parent_span_id.string], ":")), 0, 16)) where not IsRootSpan()`,
    'set(trace_state, "")',
    'set(status.message, "")',
    "set(flags, 0)",
    "set(dropped_attributes_count, 0)",
    "set(dropped_events_count, 0)",
    "set(dropped_links_count, 0)",
  ];
  return { resource, scope, span };
}

/**
 * The OpenTelemetry Collector's configuration: OTLP over HTTP behind the
 * shared token, then the rules, then an archive written one file a day.
 * Nothing else is kept, and nothing about the connection (address, headers)
 * is.
 *
 * @param {Allowlist} allowlist
 */
export function collectorConfig(allowlist) {
  const rules = compile(allowlist);
  const statements = ruleStatements(allowlist);
  const ottl = (statement) => `          - ${quoted(statement)}`;
  return `# Generated from allowlist.json by \`npm run generate\`. Do not edit.
# The same rules as the filter \`join\` installs on a participant's machine
# (src/telemetry-transform.mjs), applied again to whatever arrives.
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

  # Only PLexus's and MCP's spans, of the operations they record: any other
  # is dropped whole, as is one with links (OTTL cannot remove them), one that
  # gives an attribute twice (a rule reads only the first), or a malformed one.
  filter/spans:
    error_mode: propagate
    traces:
      span:
${dropConditions(rules).map((condition) => `        - ${quoted(condition)}`).join("\n")}

  # Keeps SAMPLING_PERCENTAGE of the traces, all of 100 unless set. Decided by
  # the trace id, so PLexus's and the image's spans of one call, sent apart,
  # are kept or dropped together.
  probabilistic_sampler:
    mode: hash_seed
    hash_seed: 22
    sampling_percentage: \${env:SAMPLING_PERCENTAGE:-100}

  # Events can carry exception messages and stacks: none is kept.
  filter/events:
    error_mode: propagate
    traces:
      spanevent:
        - "true"

  # A statement that fails refuses the whole request rather than let a value
  # through unchecked.
  transform/rules:
    error_mode: propagate
    trace_statements:
      - context: resource
        statements:
${statements.resource.map(ottl).join("\n")}
      - context: scope
        statements:
${statements.scope.map(ottl).join("\n")}
      - context: span
        statements:
${statements.span.map(ottl).join("\n")}

  # Builds each resource again from its attributes alone: fields OTTL cannot
  # reach, such as a resource's entity references, are not carried over.
  groupbyattrs/rebuild: {}

  redaction:
    allow_all_keys: true
    blocked_values:
${rules.blocked.map(({ pattern }) => `      - ${quoted(pattern)}`).join("\n")}
    summary: silent

  batch:
    timeout: 5s

exporters:
  # One file a day, traces-YYYY-MM-DD.jsonl, by the day each request arrived;
  # a day over 10 MB goes on in a further file. None is ever deleted here:
  # the import deletes each once Elasticsearch holds its spans, and guard.sh
  # stops new spans should it fall behind.
  file/archive:
    path: /archive/traces-*.jsonl
    format: json
    flush_interval: 1s
    group_by:
      enabled: true
      resource_attribute: fileexporter.path_segment
    rotation:
      max_megabytes: 10

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
      processors: [memory_limiter, filter/spans, probabilistic_sampler, filter/events, transform/rules, groupbyattrs/rebuild, redaction, batch]
      exporters: [file/archive]
`;
}

/**
 * The filter the agent runs: src/rules.js with the allowlist in it, and the
 * key read from beside it.
 *
 * @param {Allowlist} allowlist
 * @param {string} version this package's
 * @param {string} engine src/rules.js
 */
export function transformModule(allowlist, version, engine) {
  const body = engine
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n")
    .replace(/^export /gm, "")
    .replace(/^\/\/ The rules that decide[\s\S]*?\n\n/, "");
  return `// Generated from collector/allowlist.json and src/rules.js by \`npm run generate\`. Do not edit.
//
// pharo-agent-telemetry's filter. The agent passes every request the tools
// send it through this module, and sends the collector only what it returns:
// PLexus's and MCP's spans, each attribute in the shape the participants
// page gives, times to the week, ids replaced by a keyed hash. The key is
// ${keyFile}, beside this file; it never leaves this machine.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const version = ${quoted(version)};

const allowlist = ${JSON.stringify(allowlist, null, 2)};
${body}
let key;
try {
  key = readFileSync(new URL(${quoted(`./${keyFile}`)}, import.meta.url), "utf8").trim();
} catch {
  key = undefined;
}

export default createTransform(allowlist, key);

/** The same filter with another key, as \`preview\` runs it. */
export const filter = (other) => createTransform(allowlist, other);
`;
}

// The participants page.

const code = (text) => `\`${text}\``;

/** The values a closed set lists, as the page names them. */
function listed(allowlist, spec) {
  return [].concat(spec.values).flatMap((value) => allowlist.sets[value] ?? [value]);
}

/** What the rules keep of an attribute, in words. */
export function keptAs(allowlist, spec) {
  const names = {
    identifier: "an identifier",
    version: "a version",
    date: "a date",
    "product name": "a product's name",
    text: "any text",
    "JSON pointer": "a JSON pointer",
    option: "an option",
    code: "a numeric code",
  };
  const otherwise = spec.otherwise === undefined ? "" : `, else ${code(spec.otherwise)}`;
  const shape = () => {
    if (spec.values !== undefined) {
      const values = listed(allowlist, spec);
      const set = typeof spec.values === "string" ? spec.values : undefined;
      const one = set && values.length > 8 ? `one of the ${set}` : `one of ${values.map(code).join(", ")}`;
      return spec.pattern ? `${one}, or ${names[spec.pattern]}` : one;
    }
    return names[spec.pattern] ?? "text";
  };
  switch (spec.type) {
    case "bool": return "true or false";
    case "double": return "a number";
    case "int":
      if (spec.buckets) return `the lower bound of its bucket: ${spec.buckets.join(", ")}`;
      return `a whole number from ${spec.min ?? 0}`;
    case "string[]": return `a list of at most ${spec.max}, each ${shape()}`;
    default:
      if (spec.hash) return "its keyed hash";
      if (spec.extract) return `${shape()}${spec.key === "plexus.client.version" ? ", major and minor" : ""}`;
      return `${shape()}${otherwise}`;
  }
}

/** What the page says where a fact is not settled yet. */
const unsettled = (what) => `*${what}: not set yet. Nobody can join until it is.*`;

/** The placeholder for the DPO's contact, which scripts/check-release.js refuses to publish. */
export const dpoPlaceholder = "**[DPO CONTACT: TO BE FILLED IN src/collector.js BEFORE PUBLISHING]**";

/**
 * What a participant reads before joining: what is kept, what never is, who
 * answers for it, on what basis, for how long, their rights, and how to leave.
 * It is the GDPR's notice (Art. 13) for the one moment personal data is
 * processed, the connection, and says why the archive itself is anonymous.
 *
 * @param {Allowlist} allowlist
 */
export function participantsPage(allowlist, collector = { endpoint: publicEndpoint, token: publicToken, controller, dpo, host }) {
  const from = (spec) => (spec.from ?? Object.keys(allowlist.services)).join(", ");
  const rows = (attributes) => Object.entries(attributes)
    .map(([name, spec]) => `| ${code(name)} | ${from(spec)} | ${spec.about} | ${keptAs(allowlist, spec)} |`).join("\n");
  const services = Object.entries(allowlist.services);
  const spanNames = services.flatMap(([, { spans }]) => spans).filter((name, index, all) => all.indexOf(name) === index)
    .map((name) => code(name === toolCall ? `${toolCall} <tool>` : name)).join(", ");
  const nameKeys = Object.entries(allowlist.span).filter(([, spec]) => spec.name).map(([name]) => code(name)).join(", ");
  const example = settingsBlock("joined", agentSettings({ port: 4319 })).trimEnd().replace("4319", "<its port>");
  const who = collector.controller
    ? `${collector.controller.name} decides why and how this data is processed, the GDPR's controller. Write to ${collector.controller.contact} with any question, or to withdraw.`
    : unsettled("The controller and how to reach them");
  const officer = `Its data protection officer can be reached at ${collector.dpo ?? dpoPlaceholder}.`;
  const where = collector.host
    ? `- ${collector.host.provider} hosts the virtual machine the collector runs on, in ${collector.host.region}, and processes the data on the controller's behalf.
- Once a day, a scheduled job in ${collector.host.importer} copies what the collector received, loads it into ${collector.host.archive}, and deletes it from the machine and from the job's own workspace.
- ${collector.host.archive} keeps it, as "How long" says.`
    : unsettled("Where the collector runs, the GitLab that copies its archive, and where the archive is kept");
  return `<!-- Generated from collector/allowlist.json and src/collector.js by \`npm run generate\`. Do not edit. -->
# What the Pharo tools send when you join

The Pharo agent tools (the pharo-agent plugin, PLexus and Pharo MCP) can
record how agents use them, so the tools can change to fit that use: tools
nobody reaches, arguments agents expect but the tools do not take, answers
that are too long, mistakes agents repair. Joining is opt-in, and nothing is
sent until you join. The tools never ask you to.

## How it leaves your machine

Only through the agent \`join\` installs: a small program that runs as a
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
${services.map(([service]) => code(service)).join(" or ")}, its instrumentation scope is that tool's own
(${services.map(([, { scope }]) => code(scope)).join(", ")}), and it is one of the operations they record:
${spanNames}. Any other span is dropped whole, such as one your own
OpenTelemetry code makes in an image, and so is a span that has links.
Metrics and logs are not kept at all.

Of each span, only this is kept:

- its operation, \`${toolCall}\` followed by the tool's name when the attributes
  below keep it;
- its kind (server, client, internal...) and its status (unset, ok, error),
  never a status message;
- its instrumentation scope's name, and its version when it has a version's
  shape;
- its trace, span and parent ids, each replaced by a keyed hash: by the agent,
  with a key \`join\` makes and that never leaves your machine, then again at
  the collector, with a key of its own that never enters the archive. A
  call's spans still group, but nothing joins them to anything else;
- its start time, to the week (the Monday it falls in, at midnight UTC), its
  end time set to the same, and how long it took, as \`span.duration_ms\`;
- the attributes below, from the tools named, each only in the shape given: a
  value of any other shape is dropped, or replaced as the table says.

Never its events, links, trace state or status message, nor its scope's
attributes. Any value that contains ${Object.keys(allowlist.blockedValues).join(", ")} is
masked, whole, and the mask has no attribute's shape.

Tool and argument names (${nameKeys}) are kept only for MCP's own tools and for
names no tool has (\`pharo.mcp.tool.origin\` \`mcp\` or \`unknown\`). For a
tool another package added to an image (\`other\`, or no origin), the tool's
name becomes \`_OTHER\` and the other names are dropped. PLexus names only its
own tools: on a call PLexus passes on to an image, its span keeps neither the
tool's name nor its arguments', which the image's span reports as above.

Where it ran:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
${rows(allowlist.resource)}

What happened:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
${rows(allowlist.span)}

## What is never sent

- Argument values, results, source code, prompts, file contents.
- Exception messages and stacks.
- Paths, image names, project names, the names of your classes, methods or
  packages, the names of tools other packages add or of their arguments. One
  exception: a name an agent makes up for a tool or an argument that does not
  exist is kept as the agent wrote it, when it has an identifier's shape, so
  should an agent call a tool by one of your class names, that name is sent.
- Host names, user names, email addresses, IP addresses.
- Any identifier of you or your machine. There are no participant ids.
- Precise times: only the week, and how long each span took.

## Is it anonymous?

The archive is. A session's calls share a hashed \`session.id\`, so the
calls of one session can be studied together, and in order where PLexus
numbered them, but nothing in a span says who sent it, and no id links a
session to another session, to a machine or to a person. What a span says of
where it ran (the versions of the tools, of Node, Pharo and its VM, of the
agent host, and the OS family) is shared by everyone with the same setup; a
setup nobody else has would set that person's sessions apart from the
others', without saying whose they are.

One thing about you does reach the server, as it reaches any server you
connect to: your IP address, so that the connection can be made. The proxy in
front of the collector passes it on to nothing, and writes it nowhere: it
keeps no access log, and its error log, which would hold it, is switched off.
That moment is the only processing of personal data here, and this page is
its notice.

## Who answers for it

${who} ${officer}

## Who else holds it

${where}

Nobody else receives it.

## Why, and on what basis

To change the tools from how agents use them, rather than from our own
sessions alone. The basis is your consent: running \`join\` after reading this
page gives it, and \`leave\` withdraws it, at any time and with no effect on
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

You can withdraw at any time with \`leave\`, and nothing is sent from then on.
Access, correction and erasure apply to data about a person; since nothing in
the archive is about one, or can be traced back to one, there is nothing to
look up, correct or delete for you (GDPR Art. 11), and what was sent before
you left stays in the archive, as anonymous as it arrived. You can complain to
your data protection authority; in France, the CNIL (cnil.fr).

## Joining and leaving

With Node 22.15 or later:

\`\`\`sh
npx @evref-bl/pharo-agent-telemetry preview   # see what would be sent, sending nothing
npx @evref-bl/pharo-agent-telemetry join
npx @evref-bl/pharo-agent-telemetry status
npx @evref-bl/pharo-agent-telemetry leave
\`\`\`

\`join\` copies the agent into \`~/.config/pharo-agent-telemetry/\`
(\`%APPDATA%\\pharo-agent-telemetry\\\` on Windows), with its key, and runs it
as a service that starts when you log in and again if it fails: a LaunchAgent
on macOS, a systemd user unit on Linux, a scheduled task on Windows. Then it
writes a block of settings, between two marked lines, in PLexus's settings
file, \`~/.config/plexus/otel.env\`, and in MCP's, \`~/.config/pharo-mcp/otel.env\`
(under \`%APPDATA%\` on Windows):

\`\`\`text
${example}
\`\`\`

PLexus reads its file when its environment configures no OpenTelemetry of its
own, and passes it on to the images it starts; an image reads MCP's at every
start. Tools already running start sending once they restart, and images made
before joining send nothing until they are made again.

\`preview\` runs the agent in the foreground with sending off, points the
tools at it until you stop it, and prints what it would send.

\`leave\` stops and removes the agent, its files and its key, and both blocks,
wherever the settings may be. Sending stops at once: PLexus and the images
then find the agent's port closed, and nothing else leaves your machine.
Images keep running.

If the collector cannot be reached, the agent stops trying for a while; the
tools never slow down or fail a call because of it.

### With MCP alone

Using Pharo MCP in your own image, without PLexus? Join as above, then load
MCP's \`Telemetry\` group with the others you use, and switch your server to
it once:

\`\`\`smalltalk
Metacello new
   baseline: 'MCP';
   repository: 'github://Evref-BL/MCP:v4.x.x/src';
   onConflictUseIncoming;
   load: #( 'default' 'Telemetry' ).
(MCP startOnPort: 4000) useOpenTelemetryObservability
\`\`\`

The image reads MCP's settings file at every start, so it sends to the agent
from its next start on.
`;
}
