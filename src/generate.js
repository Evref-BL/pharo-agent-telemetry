// What `pharo-agent-telemetry generate` writes from a study's allowlist and
// the catalog beside it: the filter `join` installs on a participant's
// machine, the collector's configuration, which applies the same rules again
// in OTTL, and the participants page.
import {
  compile, forwardedKey, kinds, longestMilliseconds, masked, offsetKey, originKey, sessionKey, toolCall, toolKey, wordBoundaries,
} from "./rules.js";
import { keyFile } from "./install.js";
import fs from "node:fs";
import { agentSettings, settingsBlock } from "./settings.js";
import { readAllowlist, studyCommand, studyPath } from "./study.js";

/** @typedef {any} Allowlist a study's allowlist.json, with the sets of its catalog.json */

/** A YAML double-quoted string, which takes JSON's escapes; an OTTL string literal too. */
const quoted = (text) => JSON.stringify(text);

/** An OTTL list of string literals. */
const ottlList = (names) => `[${names.map(quoted).join(", ")}]`;

/** The collector's key, from its environment: it hashes ids again, and never enters the archive. */
const keyVariable = "${env:ID_HASH_KEY}";

/** The Monday a span's start falls in, in nanoseconds, as text: what ids and session ids are hashed within. */
const weekText = 'String(UnixNano(TruncateTime(start_time, Duration("168h"))))';

/** Where a value's word form is put while the vocabulary check reads it; never kept. */
const wordsKey = "pharo_agent_telemetry.words";

/**
 * A list whose elements each have the element pattern, as the JSON text
 * OTTL's String() makes of it. Its length is checked apart: RE2 refuses a
 * counted repetition of a pattern that counts its own.
 */
function listPattern(elementPattern) {
  return `^\\[(?:\\]|(?:"(?:${elementPattern.replace(/^\^/, "").replace(/\$$/, "")})"[,\\]])+)$`;
}

/** A list of strings and nothing else, as String() writes it. */
const stringsPattern = listPattern('(?:[^"\\\\]|\\\\.)*');

const ottlTypes = { string: "IsString", int: "IsInt", bool: "IsBool", double: "IsDouble", "string[]": "IsList" };

/**
 * The statements that put a value's word form, as src/rules.js reads it, in
 * the words attribute: `what` is the value, `condition` when to.
 */
const wordForm = (what, condition) => [
  `set(attributes[${quoted(wordsKey)}], ${what}) where ${condition}`,
  // Go reads `$1_` as the group named `1_`: groups are written `${1}`, and `$$` keeps the collector from reading `${1}` as a variable.
  ...wordBoundaries.map(([pattern, replacement]) => `replace_pattern(attributes[${quoted(wordsKey)}], ${quoted(pattern)}, ${quoted(replacement.replace(/\$([0-9])/g, (_, group) => `$\${${group}}`))})`),
  `set(attributes[${quoted(wordsKey)}], ToLowerCase(attributes[${quoted(wordsKey)}])) where IsString(attributes[${quoted(wordsKey)}])`,
];

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
  const words = `attributes[${quoted(wordsKey)}]`;
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
  const otherwise = (condition) => (spec.otherwise === undefined ? drop(condition) : `set(${at}, ${quoted(spec.otherwise)}) where ${condition}`);
  if (spec.type === "string" && spec.pattern) statements.push(otherwise(`IsString(${at}) and not IsMatch(${at}, ${quoted(spec.pattern)})`));
  if (spec.type === "string" && spec.words) {
    statements.push(
      ...wordForm(at, `IsString(${at})`),
      otherwise(`IsString(${words}) and not IsMatch(${words}, ${quoted(spec.wordsPattern)})`),
      `delete_key(attributes, ${quoted(wordsKey)})`,
    );
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
  if (spec.type === "double" && spec.whole) {
    statements.push(drop(`IsDouble(${at}) and ${at} >= ${longestMilliseconds.toFixed(1)}`));
    statements.push(`set(${at}, Double(Int(${at}))) where IsDouble(${at})`);
  }
  if (spec.type === "string[]") {
    statements.push(drop(`IsList(${at}) and Len(${at}) > ${spec.max}`));
    statements.push(drop(`IsList(${at}) and not IsMatch(String(${at}), ${quoted(stringsPattern)})`));
    if (spec.published) {
      for (let index = 0; index < spec.max; index += 1) {
        statements.push(`set(${at}[${index}], ${quoted(spec.otherwise)}) where IsList(${at}) and Len(${at}) > ${index} and not IsMatch(${at}[${index}], ${quoted(rules.publishedPattern)})`);
      }
    } else {
      if (spec.pattern) statements.push(drop(`IsList(${at}) and not IsMatch(String(${at}), ${quoted(listPattern(spec.pattern))})`));
      if (spec.words) {
        statements.push(
          ...wordForm(`String(${at})`, `IsList(${at})`),
          drop(`IsString(${words}) and not IsMatch(${words}, ${quoted(spec.wordsPattern)})`),
          `delete_key(attributes, ${quoted(wordsKey)})`,
        );
      }
    }
  }
  if (spec.default !== undefined) statements.push(`set(${at}, ${quoted(spec.default)}) where ${at} == nil${spec.from ? ` and ${isService(spec.from)}` : ""}`);
  if (spec.hash) statements.push(`set(${at}, Substring(SHA256(Concat([${quoted(keyVariable)}, ${quoted(spec.hash)}, ${weekText}, ${at}], ":")), 0, 32)) where IsString(${at})`);
  return statements;
}

/** What a span needs of the attributes a service requires: each a string the rules keep, so not empty. */
function requiredCondition(rules, key) {
  const spec = rules.span.find((each) => each.key === key);
  if (spec?.type !== "string" || spec.pattern !== "^(?:[\\s\\S]+)$" || spec.from) throw new Error(`A required attribute must be a string of any text from every service: ${key} is not.`);
  return `not IsString(attributes[${quoted(key)}]) or attributes[${quoted(key)}] == ""`;
}

/** The conditions that drop a span whole: not one of ours, not of a kind or without an attribute its service requires, links, an attribute given twice, malformed. */
export function dropConditions(rules) {
  const ours = Object.entries(rules.services).map(([service, { scope, namePattern }]) =>
    `(resource.attributes["service.name"] == ${quoted(service)} and instrumentation_scope.name == ${quoted(scope)} and IsMatch(name, ${quoted(namePattern)}))`);
  const required = Object.entries(rules.services).filter(([, { kinds: wanted, requires }]) => wanted || requires.length > 0).map(([service, { kinds: wanted, requires }]) => {
    const conditions = [...(wanted ? [`not (${wanted.map((kind) => `kind == ${kind}`).join(" or ")})`] : []), ...requires.map((key) => requiredCondition(rules, key))];
    return `resource.attributes["service.name"] == ${quoted(service)} and (${conditions.join(" or ")})`;
  });
  return [
    `not (${ours.join(" or ")})`,
    ...required,
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

/** The statements that keep a tool's name and the names that go with it only where src/rules.js keeps them (keepNames). */
function nameStatements(rules, spanService) {
  const tool = `attributes[${quoted(toolKey)}]`;
  const words = `attributes[${quoted(wordsKey)}]`;
  const names = rules.span.filter((spec) => spec.name);
  const published = `(IsString(${tool}) and IsMatch(${tool}, ${quoted(rules.publishedPattern)}))`;
  const statements = [];
  const mcp = Object.entries(rules.services).find(([, { tools }]) => !tools)?.[0];
  if (mcp) {
    const isMcp = `${spanService} == ${quoted(mcp)}`;
    const isOther = `${isMcp} and attributes[${quoted(originKey)}] == "other"`;
    statements.push(
      ...wordForm(tool, `${isMcp} and IsString(${tool}) and not IsMatch(${tool}, ${quoted(rules.publishedPattern)})`),
      `set(${tool}, "_OTHER") where IsString(${words}) and (attributes[${quoted(originKey)}] == "other" or not IsMatch(${words}, ${quoted(rules.words.name.scalar)}))`,
      `delete_key(attributes, ${quoted(wordsKey)})`,
      ...rules.span.filter((spec) => spec.own).map((spec) => `delete_key(attributes, ${quoted(spec.key)}) where ${isOther} and not ${published}`),
      ...names.map((spec) => {
        const at = `attributes[${quoted(spec.key)}]`;
        return spec.nameOther === undefined
          ? `delete_key(attributes, ${quoted(spec.key)}) where ${isOther} and not ${published}`
          : `set(${at}, ${quoted(spec.nameOther)}) where ${isOther} and not ${published} and ${at} != nil`;
      }),
    );
  }
  for (const [service, { toolPattern }] of Object.entries(rules.services).filter(([, { tools }]) => tools)) {
    const isService = `${spanService} == ${quoted(service)}`;
    const forwarded = `${isService} and (attributes[${quoted(forwardedKey)}] == true or kind == ${kinds.client} or not (IsString(${tool}) and IsMatch(${tool}, ${quoted(toolPattern)})))`;
    statements.push(
      `set(${tool}, "_OTHER") where ${isService} and IsString(${tool}) and not IsMatch(${tool}, ${quoted(rules.publishedPattern)})`,
      ...names.filter((spec) => !spec.tool).map((spec) => `delete_key(attributes, ${quoted(spec.key)}) where ${forwarded}`),
    );
  }
  return statements;
}

/** The statements that hash an id within its session and week, as src/rules.js does. */
function idStatements(field, tag, length, condition) {
  const session = `attributes[${quoted(sessionKey)}]`;
  const hashed = (sessionText) => `Substring(SHA256(Concat([${quoted(keyVariable)}, ${quoted(tag)}, String(start_time_unix_nano), ${sessionText}, ${field}], ":")), 0, ${length})`;
  const where = (extra) => (condition ? `${condition} and ${extra}` : extra);
  return [
    `set(${field}, ${hashed(session)}) where ${where(`IsString(${session})`)}`,
    `set(${field}, ${hashed('""')}) where ${where(`not IsString(${session})`)}`,
  ];
}

/** The statements that keep an attribute only beside another that holds a value of its set (keepAll's `beside`). */
function besideStatements(specs) {
  return specs.filter((spec) => spec.beside).map((spec) => {
    const other = specs.find((each) => each.key === spec.beside);
    const at = `attributes[${quoted(spec.beside)}]`;
    return `delete_key(attributes, ${quoted(spec.key)}) where ${at} == nil${other?.otherwise === undefined ? "" : ` or ${at} == ${quoted(other.otherwise)}`}`;
  });
}

/** The OTTL statements of each context, in the order src/rules.js applies the same rules. */
export function ruleStatements(allowlist) {
  const rules = compile(allowlist);
  const resourceService = 'attributes["service.name"]';
  const spanService = 'resource.attributes["service.name"]';
  const resource = [
    `keep_keys(attributes, ${ottlList(rules.resource.map((spec) => spec.key))})`,
    ...rules.resource.flatMap((spec) => attributeStatements(rules, spec, resourceService)),
    ...besideStatements(rules.resource),
    ...rules.resource.filter((spec) => spec.when).map((spec) =>
      `delete_key(attributes, ${quoted(spec.key)}) where ${Object.entries(spec.when).map(([key, value]) => `attributes[${quoted(key)}] != ${quoted(value)}`).join(" or ")}`),
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
  const span = [
    `keep_keys(attributes, ${ottlList(rules.span.map((spec) => spec.key))})`,
    ...rules.span.flatMap((spec) => attributeStatements(rules, spec, spanService)),
    ...besideStatements(rules.span),
    ...nameStatements(rules, spanService),
    `delete_key(attributes, ${quoted(offsetKey)}) where attributes[${quoted(sessionKey)}] == nil`,
    `set(name, Concat([${quoted(toolCall)}, attributes[${quoted(toolKey)}]], " ")) where IsMatch(name, ${quoted(`^${toolCall}(?: [\\s\\S]*)?$`)}) and IsString(attributes[${quoted(toolKey)}])`,
    `set(name, ${quoted(toolCall)}) where IsMatch(name, ${quoted(`^${toolCall} `)}) and attributes[${quoted(toolKey)}] == nil`,
    'set(attributes["span.duration_ms"], Double(Milliseconds(end_time - start_time))) where end_time_unix_nano > start_time_unix_nano',
    'set(attributes["span.duration_ms"], 0.0) where attributes["span.duration_ms"] == nil',
    'set(start_time, TruncateTime(start_time, Duration("168h")))',
    "set(end_time, start_time)",
    ...idStatements("trace_id.string", "trace", 32),
    ...idStatements("span_id.string", "span", 16),
    ...idStatements("parent_span_id.string", "span", 16, "not IsRootSpan()"),
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
  return `# Generated from the study's allowlist.json by \`pharo-agent-telemetry generate\`. Do not edit.
# The same rules as the filter \`join\` installs on a participant's machine
# (telemetry-transform.mjs), applied again to whatever arrives.
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

  # Only the listed services' spans, of the operations they record: any other
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
  # the import deletes each once the study's store holds its spans, and guard.sh
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

/** JSON indented by two, but a list of strings or numbers on one line. */
function compactJson(value, indent = "") {
  if (Array.isArray(value) && value.every((each) => typeof each !== "object" || each === null)) return JSON.stringify(value).replace(/","/g, '", "');
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  const entries = Array.isArray(value) ? value.map((each) => compactJson(each, inner)) : Object.entries(value).map(([key, each]) => `${JSON.stringify(key)}: ${compactJson(each, inner)}`);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return entries.length === 0 ? `${open}${close}` : `${open}\n${entries.map((each) => `${inner}${each}`).join(",\n")}\n${indent}${close}`;
}

/**
 * The filter the agent runs: src/rules.js with the allowlist in it, and the
 * key read from beside it.
 *
 * @param {Allowlist} allowlist
 * @param {string} version the study's
 * @param {string} engine src/rules.js
 */
export function transformModule(allowlist, version, engine) {
  const body = engine
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n")
    .replace(/^export /gm, "")
    .replace(/^\/\/ The rules that decide[\s\S]*?\n\n/, "");
  return `// Generated from allowlist.json, catalog.json and pharo-agent-telemetry's rules by \`pharo-agent-telemetry generate\`. Do not edit.
//
// The study's filter. The agent passes every request the tools
// send it through this module, and sends the collector only what it returns:
// PLexus's and MCP's spans, each attribute in the shape the participants
// page gives, times to the week, ids replaced by a keyed hash. The key is
// ${keyFile}, beside this file; it never leaves this machine.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const version = ${quoted(version)};

const allowlist = ${compactJson(allowlist)};
${body}
let key;
try {
  key = readFileSync(new URL(${quoted(`./${keyFile}`)}, import.meta.url), "utf8").trim();
} catch {
  key = undefined;
}

export default createTransform(allowlist, key, { filterVersion: version });

/** The same filter with another key, as \`preview\` runs it; without the places in sessions with \`{ offsets: false }\`; without its version on each span with \`{ filterVersion: undefined }\`; with a newer catalog's sets with \`{ catalog }\`. */
export const filter = (other, options) => createTransform(allowlist, other, { filterVersion: version, ...options });

/** The catalog this filter was generated with: its form, its date, and the releases it was read from. */
export const catalog = { schema: catalogSchema, published: allowlist.catalogPublished, releases: allowlist.releases };

/** Why this filter cannot read a catalog at all, or undefined when it can. */
export const catalogRefusal = (other) => catalogProblem(other);

/** What a catalog adds to this filter's sets, set by set. */
export const catalogAdded = (other) => catalogAdditions(allowlist, other);
`;
}

/**
 * The filter a study's data makes, with this package's rules: what `join`
 * installs and `preview` runs, whatever filter file the study ships.
 *
 * @param {import("./study.js").Study} study
 */
export function studyFilter(study) {
  return transformModule(readAllowlist(study), study.version, fs.readFileSync(new URL("./rules.js", import.meta.url), "utf8"));
}

/**
 * Why the filter a study ships is not the one its data makes with this
 * package's rules, or undefined when it is: a study edited by hand, or
 * generated by another version of this package.
 *
 * @param {import("./study.js").Study} study
 */
export function shippedFilterProblem(study) {
  let shipped;
  try {
    shipped = fs.readFileSync(studyPath(study, "filter"), "utf8");
  } catch {
    shipped = undefined;
  }
  if (shipped === studyFilter(study)) return undefined;
  return `${study.name} ${study.version} ships a filter that is not the one its allowlist and catalog make with pharo-agent-telemetry ${ownVersion}: nothing is installed. Its package needs generating again`;
}

/** This package's version. */
const ownVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// The participants page.

const code = (text) => `\`${text}\``;

/** The values a closed set lists, as the page names them. */
function listed(allowlist, spec) {
  return [].concat(spec.values).flatMap((value) => allowlist.sets[value] ?? [value]);
}

/** How much of a version an `extract` pattern keeps. */
const precision = (pattern) => (/\(\[0-9\]\{1,4\}\\\.\[0-9\]\{1,4\}\)/.test(pattern) ? "major and minor" : "major");

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
    variant: "a build's name",
  };
  const otherwise = spec.otherwise === undefined ? "" : `, else ${code(spec.otherwise)}`;
  const words = spec.words === "pointer" ? ", each name in it made of the vocabulary's words" : spec.words ? ", made of the vocabulary's words" : "";
  const shape = () => {
    if (spec.values !== undefined) {
      const values = listed(allowlist, spec);
      const sets = [].concat(spec.values);
      const named = sets.every((each) => each in allowlist.sets) && values.length > 8;
      const one = named ? `one of the ${sets.length === 1 ? sets[0] : `${sets.slice(0, -1).join(", ")} or ${sets.at(-1)}`}` : `one of ${values.map(code).join(", ")}`;
      return spec.pattern ? `${one}, or ${names[spec.pattern]}` : one;
    }
    return names[spec.pattern] ?? "text";
  };
  const conditions = [
    ...(spec.own ? [", not for another package's tool that no project publishes"] : []),
    ...(spec.beside ? [`, only beside a ${code(spec.beside)} of that set`] : []),
    ...(spec.when ? [`, only beside ${Object.entries(spec.when).map(([key, value]) => `${code(key)} ${code(value)}`).join(" and ")}`] : []),
  ].join("");
  const kept = (() => {
    switch (spec.type) {
      case "bool": return "true or false";
      case "double": return spec.whole ? `a whole number from ${spec.min ?? 0}` : "a number";
      case "int":
        if (spec.buckets) return `the lower bound of its bucket: ${spec.buckets.join(", ")}`;
        return spec.min === undefined ? "a whole number" : `a whole number from ${spec.min}`;
      case "string[]":
        if (spec.published) return `a list of at most ${spec.max}, each a tool a project publishes${otherwise}`;
        return `a list of at most ${spec.max}, each ${shape()}${words}`;
      default:
        if (spec.hash) return "its keyed hash, within its week";
        if (spec.tool) return `a tool a project publishes, else ${shape()} made of the vocabulary's words${otherwise}`;
        if (spec.extract) {
          const cut = typeof spec.extract === "string" ? precision(spec.extract) : Object.entries(spec.extract).map(([service, pattern]) => `${precision(pattern)} from ${service}`).join(", ");
          return `${shape()}, ${cut}`;
        }
        return `${shape()}${words}${otherwise}`;
    }
  })();
  return `${kept}${conditions}`;
}

/** What the page says where a fact is not settled yet. */
const unsettled = (what) => `*${what}: not set yet. Nobody can join until it is.*`;

/**
 * What a participant reads before joining: what is kept, what never is, who
 * answers for it, on what basis, for how long, their rights, and how to leave.
 * It names no law: what it says holds for the package's own stack anywhere,
 * and a study adds what its law asks for (a DPO, an authority). Under the
 * GDPR, for example, it is the notice (Art. 13) for the one moment personal
 * data is processed, the connection, and says why the archive is anonymous.
 *
 * @param {Allowlist} allowlist
 */
/**
 * @param {Allowlist} allowlist
 * @param {import("./study.js").Study} study
 */
export function participantsPage(allowlist, study) {
  const { collector, text } = study;
  const npx = studyCommand(study);
  const from = (spec) => (spec.from ?? Object.keys(allowlist.services)).join(", ");
  const rows = (attributes) => Object.entries(attributes)
    .map(([name, spec]) => `| ${code(name)} | ${from(spec)} | ${spec.about} | ${keptAs(allowlist, spec)} |`).join("\n");
  const services = Object.entries(allowlist.services);
  const serviceLines = services.map(([service, { scope, spans, kinds: wanted, requires = [] }]) => {
    const operations = spans.map((name) => code(name === toolCall ? `${toolCall} <tool>` : name)).join(", ");
    const kept = [
      wanted ? `of kind ${wanted.join(" or ")} only` : "of every kind",
      ...(requires.length > 0 ? [`and only with ${requires.map(code).join(" and ")}`] : []),
    ].join(" ");
    return `- from ${code(service)}, with its scope ${code(scope)}: ${operations}, ${kept}.`;
  }).join("\n");
  const checkedKeys = Object.entries(allowlist.span).filter(([, spec]) => spec.words || spec.published || spec.tool).map(([name]) => code(name)).join(", ");
  const example = settingsBlock("joined", agentSettings({ port: 4319 }), npx).trimEnd().replace("4319", "<its port>");
  const setLines = Object.entries(allowlist.sets)
    .filter(([name]) => !allowlist.vocabulary.includes(name))
    .map(([name, values]) => `- ${name}: ${values.map(code).join(", ")}.`).join("\n");
  const vocabularySize = new Set(allowlist.vocabulary.flatMap((name) => allowlist.sets[name])).size;
  const mcpScope = allowlist.services["pharo-mcp"]?.scope;
  const serviceNames = { plexus: "PLexus's", "pharo-mcp": "MCP's" };
  const kept = Object.keys(allowlist.services).map((name) => serviceNames[name]).join(" and ");
  const growing = Object.keys(allowlist.grows ?? {}).join(", ");
  const releases = Object.entries(allowlist.releases ?? {}).map(([project, release]) => `${project} ${release}`).join(", ");
  const projectNames = Object.keys(allowlist.releases ?? {});
  const projects = projectNames.length > 1 ? `${projectNames.slice(0, -1).join(", ")} and ${projectNames.at(-1)}` : projectNames[0] ?? "the tools' projects";
  const who = collector.controller
    ? `${collector.controller.name} runs this study and decides why and how this data is processed. Write to ${collector.controller.contact} with any question, or to withdraw.`
    : unsettled("Who runs the study and how to reach them");
  const officer = collector.dpo ? ` Its data protection officer can be reached at ${collector.dpo}.` : "";
  const where = collector.host
    ? `- ${collector.host.provider} hosts the virtual machine the collector runs on, in ${collector.host.region}, and processes the data for the study.
- Once a day, a scheduled job in ${collector.host.importer} copies what the collector received, loads it into ${collector.host.archive}, and deletes it from the machine and from the job's own workspace.
- ${collector.host.archive} keeps it, as "How long" says.`
    : unsettled("Where the collector runs, the job that copies its archive, and where the archive is kept");
  return `<!-- Generated from study.json, allowlist.json and catalog.json by \`pharo-agent-telemetry generate\`. Do not edit. -->
# What the Pharo tools send when you join

The Pharo agent tools (the pharo-agent plugin, PLexus and Pharo MCP) can
record how agents use them. ${text.purpose.trim()} Joining is opt-in, and
nothing is sent until you join. The tools never ask you to.

## How it leaves your machine

Only through the agent \`join\` installs: a small program that runs as a
service of your user account, listens on a port of your own machine
(127.0.0.1), takes what the tools send it, keeps only what this page lists,
and sends that to the collector. The tools' settings point them at the agent
and hold no token: the agent alone knows the collector. PLexus, the images it
starts, and an image you start yourself once it is set up as "With MCP alone"
says, all send to the agent.

The collector applies the same rules again to whatever arrives, and drops
what they do not keep. Both are made from one list, and so is this page.

The agent updates its lists of the Pharo tools' names and words, and nothing
else, from the study's server: at most once a day it asks the collector's
server for a newer catalog, and takes it only when the study's key signed it.
A catalog can only add, and only to the lists that grow with the tools'
releases (${growing}): it never removes a name, adds an agent host or any
other value, or changes which attributes are kept or in what shape. The
study's key can
thus add names and words to those lists, which would let names made of such
words through; \`status\` shows what the catalog in use added. Were that key
compromised, it would be replaced only by joining again with a package that
names a new one.

## What is kept

Only ${kept} spans of the operations they record:

${serviceLines}

Any other span is dropped whole, such as one your own OpenTelemetry code
makes in an image, and so is a span that has links. Metrics and logs are not
kept at all.${mcpScope === undefined ? "" : ` A span your own code makes of kind server, with the tracer
\`${mcpScope}\`, named \`${toolCall}\` and a name, and with a \`session.id\`, cannot be
told from MCP's: it is kept as \`${toolCall} _OTHER\`, or with its tool's name
when that name passes as "Names" says, with nothing but what this page lists.`}

Of each span, only this is kept:

- its operation, \`${toolCall}\` followed by the tool's name when the attributes
  below keep it;
- its kind (server, client, internal...) and its status (unset, ok, error),
  never a status message;
- its instrumentation scope's name, and its version when it has a version's
  shape;
- its trace, span and parent ids, each replaced by a keyed hash, within its
  session and week: by the agent, with a key \`join\` makes and that never
  leaves your machine, then again at the collector, with a key of its own
  that never enters the archive. A call's spans still group, but nothing
  joins them to anything else, nor one session's to another's, even when the
  agent host gives every session the same trace;
- its start time, to the week (the Monday it falls in, at midnight UTC), its
  end time set to the same, how long it took, in whole milliseconds, as
  \`span.duration_ms\`, and, for a span with a session, when it started in
  milliseconds after the first span of that session the agent saw, as
  \`pharo_agent_telemetry.session.offset_ms\`;
- the attributes below, from the tools named, each only in the shape given: a
  value of any other shape is dropped, or replaced as the table says.

Never its events, links, trace state or status message, nor its scope's
attributes. Any value that contains ${Object.keys(allowlist.blockedValues).join(", ")} is
masked, whole, and the mask has no attribute's shape.

### Names

A name an agent or another package chooses (${checkedKeys}) is kept only
when it is the name of a tool a project publishes, or when every word of it
(split at \`_\`, \`-\` and capitals) is in the vocabulary: the
${vocabularySize} words of the names in the code of ${projects} (their
tools, arguments, errors and the rest), read from
their source (${releases}), and of a list of words agents guess. Any
other name is dropped, or becomes \`_OTHER\`. A name is kept only when it is
made of words the tools use, so a name of your own made only of such words
can pass, such as a class \`ClassName\` or an argument \`class_name\`; a name
with any other word in it cannot. Both lists are in
[catalog.json](../catalog.json) and
[allowlist.json](../allowlist.json).

The names of a tool another package added to an image (\`pharo.mcp.tool.origin\`
\`other\`, or no origin) are kept only when a project publishes that tool:
otherwise its tool's name becomes \`_OTHER\`, and the other names and its
error code are dropped. PLexus
names only its own tools: on a call PLexus passes on to an image, its span
keeps the tool's name only when a project publishes it, and never the
arguments' names, which the image's span reports as above.

Where it ran:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
${rows(allowlist.resource)}

What happened:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
${rows(allowlist.span)}

The closed sets the table names, the tools each project publishes among them:

${setLines}

## What is never sent

- Argument values, results, source code, prompts, file contents.
- Exception messages and stacks.
- Paths and image names.
- Any name with a word the vocabulary does not have, as most names of your
  projects, classes, methods and packages have; a name made only of its
  words can pass, as "Names" says.
- Host names, user names, email addresses, IP addresses.
- Any identifier of you or your machine. There are no participant ids.
- Precise times: only the week, how long each span took, and its place in
  its session.

## Is it anonymous?

The archive is. A session's spans share a \`session.id\`: PLexus makes one at
random for the calls of an agent host, and MCP, from 4.3, makes one when a
call comes without one (a call to an earlier MCP alone carries no session,
and is not kept). The agent hashes it within its
week, and the collector again, so the calls of one session can be studied
together, and in order, but no id links a session to another session, to a
machine or to a person.

Nothing in a span says who sent it. What could still set a participant
apart is a rare setup: what a span says of where it ran (the versions of
PLexus and MCP, Node's major version, Pharo's major and minor, the agent host
and its major and minor version, and the OS family) is shared by everyone
with the same setup, but a combination nobody else has would set that
person's sessions apart from the others'. Someone who already knew that a
person runs that combination could tell which sessions are theirs, and learn
from them only how that person used the tools. The agent host's and
Pharo's versions are kept to major and minor, and Node's to major, so that
such combinations are rarer.

One thing about you does reach the server, as it reaches any server you
connect to: your IP address, so that the connection can be made. The proxy in
front of the collector passes it on to nothing, and writes it nowhere: it
keeps no access log, and its error log, which would hold it, is switched off.
That moment is the only processing of personal data here, and this page is
its notice.

## Who answers for it

${who}${officer}

## Who else holds it

${where}

${text.publication?.trim() ?? "Nobody else receives it."}

## Why, and on what basis

${text.why.trim()} The basis is your consent: running \`join\` after reading this
page gives it, and \`leave\` withdraws it, at any time and with no effect on
what the tools do for you.

## How long

The collector writes what arrives into one file a day, named after the day
it arrived, a day the file's spans also carry; the import keeps neither. The
collector never deletes a file the daily import has not loaded, and the
import deletes each file once the study's store holds its spans. Should the
import stop, the collector refuses new spans once its archive takes half its
disk's free space, rather than delete any. ${text.retention.trim()}

## Your rights

You can withdraw at any time with \`leave\`, and nothing is sent from then on.
Access, correction and erasure apply to data about a person; since nothing in
the archive is about one, or can be traced back to one, there is nothing to
look up, correct or delete for you, and what was sent before you left stays
in the archive, as anonymous as it arrived.${text.authority ? ` You can complain to
your data protection authority: ${text.authority.trim()}` : ""}

## Joining and leaving

With Node 22.15 or later:

\`\`\`sh
${npx} preview   # see what would be sent, sending nothing
${npx} join
${npx} status
${npx} leave
\`\`\`

\`join\` copies the agent into \`pharo-agent-telemetry/\` under
\`~/.config\` (\`$XDG_CONFIG_HOME\` when set, \`%APPDATA%\` on Windows), with its
key, and runs it as a service that starts when you log in and again if it
fails: a LaunchAgent on macOS, a systemd user unit on Linux, a scheduled task
at logon on Windows, which runs it with no window and starts it again 30
seconds after it fails. Its port is below the range your system hands out to
other programs, so that none takes it while the agent is down. Then it writes a block of settings, between two marked lines,
in PLexus's settings file, \`plexus/otel.env\`, and in MCP's,
\`pharo-mcp/otel.env\`, under \`~/.config\` (\`%APPDATA%\` on Windows), and under
\`$XDG_CONFIG_HOME\` too when it is set:

\`\`\`text
${example}
\`\`\`

A settings file you already had is kept beside it, as
\`otel.env.before-join\`, and \`leave\` puts it back; \`join\` refuses to replace
OpenTelemetry settings of your own unless you add \`--force\`. Your own
OpenTelemetry code in an image then sends to the agent too, which drops its
spans but those "What is kept" says it cannot tell from MCP's.

Where your system will not run a service of your account (over SSH on macOS,
or on Linux without a systemd user session), \`join --no-service\` installs
none: the agent then sends only while
\`${npx} agent\` runs.

PLexus reads its file at start, and passes it on to the images it starts; an
image reads MCP's at every start. From PLexus 0.21 and MCP 4.3, a
tool's file replaces any OpenTelemetry settings (\`OTEL_*\`) it inherits from
the agent host; before, an agent host that passes such settings sends the
tools' spans where they say instead. Restart your agent host after joining:
images made before that restart send nothing until they are made again.

\`status\` says whether the agent answers on its port, and what it received
and sent. \`preview\` runs an agent in the foreground with sending off and
prints what it would send: not joined, it points the tools at itself until
you stop it, and they read that when they start, so restart your agent host
and images; joined, it takes the agent's place on its port while it runs, so
the tools already running show in it, and starts the agent again after.

\`leave\` stops and removes the agent, its files and its key, and both blocks,
wherever the settings may be. Sending stops at once: PLexus and the images
then find the agent's port closed, and nothing else leaves your machine.
Images keep running.

If the collector cannot be reached, the agent stops trying for a while; the
tools never slow down or fail a call because of it.

### With MCP alone

Using Pharo MCP in your own image, without PLexus? From MCP 4.3, it records
calls, in a session of its own. Join as above, then,
in the image:

1. Load MCP's \`Telemetry\` group from the repository you loaded MCP from:
   the same \`baseline: 'MCP'; repository: ...\` as when you loaded it, with
   \`load: #( 'Telemetry' )\`.
2. Evaluate \`MCP useOpenTelemetryObservabilityByDefault\`, which switches
   every MCP server of the image, and save the image. Unsaved, the setting is
   lost at the next start.

The image reads MCP's settings file at every start, so it sends to the agent
from then on. Several projects that use the same image's server share one
session. An image in a container cannot reach the agent: the container's
127.0.0.1 is not your machine's.
`;
}
