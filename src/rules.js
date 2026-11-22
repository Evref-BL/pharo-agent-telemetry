// The rules that decide what of a span is kept, as JavaScript: the filter
// `join` installs on a participant's machine runs them on everything PLexus
// sends, and `npm run audit` runs them on an archive to see whether it holds
// anything they would not have kept. collector/otelcol.yaml applies the same
// rules again, written in OTTL by src/generate.js from the same allowlist; a
// test runs one set of fixtures through both and requires them to agree.
//
// generate.js copies this file into src/telemetry-transform.mjs, so it
// imports nothing but Node's own modules.
import { createHash } from "node:crypto";

const kindNames = ["SPAN_KIND_UNSPECIFIED", "SPAN_KIND_INTERNAL", "SPAN_KIND_SERVER", "SPAN_KIND_CLIENT", "SPAN_KIND_PRODUCER", "SPAN_KIND_CONSUMER"];
const statusNames = ["STATUS_CODE_UNSET", "STATUS_CODE_OK", "STATUS_CODE_ERROR"];
const clientKind = 3;

/** The kinds a service may require, by the name the allowlist gives them. */
export const kinds = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 };

/** A week in nanoseconds, and a Monday at midnight UTC: times are kept to the week they fall in. */
const week = 604_800_000_000_000n;
const monday = 345_600_000_000_000n;

/** 2^63: no int64 reaches it, nor a time in nanoseconds the collector and Elasticsearch read (2262). */
const int64 = 9_223_372_036_854_775_808n;

/** The longest duration in milliseconds a span's int64 times can give, rounded up: a double past it is no duration. */
export const longestMilliseconds = 9_300_000_000_000;

/** What a value that holds an address, a path or an email becomes before its shape is checked. */
export const masked = "****";

/** The operation a span named `tools/call <tool>` performed; the tool after it is the span's gen_ai.tool.name. */
export const toolCall = "tools/call";

/** The attributes the rules read beyond their own value: the tool, whose it is, and the session. */
export const toolKey = "gen_ai.tool.name";
export const originKey = "pharo.mcp.tool.origin";
export const forwardedKey = "plexus.call.forwarded";
export const sessionKey = "session.id";

/** The attribute the agent adds: where a span comes in its session, which times kept to the week lose. */
export const offsetKey = "pharo_agent_telemetry.session.offset_ms";

/**
 * A name as the vocabulary check reads it: each camelCase word boundary
 * (`className`, `HTTPServer`) made a `_`, in lower case. Written as the two
 * replacements and the case change the collector's OTTL makes.
 */
export const wordBoundaries = [["([A-Z])([A-Z][a-z])", "$1_$2"], ["([a-z0-9])([A-Z])", "$1_$2"]];

/** A name with its word boundaries made `_`, in lower case. */
export function wordForm(name) {
  return wordBoundaries.reduce((text, [pattern, replacement]) => text.replace(new RegExp(pattern, "g"), replacement), name).toLowerCase();
}

/** The words of a name, as the vocabulary check reads them. */
export function nameWords(name) {
  return wordForm(name).split(/[_-]/);
}

/** A pattern written for Go's RE2 as a JavaScript RegExp: a leading `(?flags)` becomes the RegExp's flags. */
export function regExp(pattern) {
  const flags = /^\(\?([a-z]+)\)/.exec(pattern);
  return new RegExp(flags ? pattern.slice(flags[0].length) : pattern, flags ? flags[1] : "");
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unanchored = (pattern) => pattern.replace(/^\^/, "").replace(/\$$/, "");

/** An alternation of words that shares their prefixes, a pattern both RE2 and JavaScript read: `(?:class(?:es)?|...)`. */
export function alternation(words) {
  const trie = new Map();
  for (const word of words) {
    let node = trie;
    for (const character of word) {
      if (!node.has(character)) node.set(character, new Map());
      node = node.get(character);
    }
    node.set("", new Map());
  }
  const emit = (node) => {
    const branches = [...node].filter(([character]) => character !== "").sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([character, child]) => `${escaped(character)}${emit(child)}`);
    if (branches.length === 0) return "";
    const group = branches.length === 1 && !node.has("") ? branches[0] : `(?:${branches.join("|")})`;
    return node.has("") ? `${group}?` : group;
  };
  return `(?:${emit(trie)})`;
}

/**
 * The patterns a value's word form must match to be made of the
 * vocabulary's words, the same for both filters: a name (`class_name`, from
 * `className`), as itself or as the elements of a list, written as the JSON
 * text OTTL's String() makes of a list of strings (`["class_name","side"]`);
 * or a list of JSON pointers of names and indices (`/scope/classes/0`).
 */
function wordPatterns(words) {
  const word = alternation([...new Set(words)].sort());
  const end = '"[,\\]]';
  const list = (element) => `^\\[(?:\\]|(?:${element})+)$`;
  return {
    name: { scalar: `^(?:${word}[_-])*${word}$`, list: list(`"(?:${word}(?:[_-]|${end}))+`) },
    // An index as MCP writes one: no leading zero, which would let any digits through.
    pointer: { list: list(`"(?:${end}|/(?:(?:${word}|0|[1-9][0-9]{0,2})(?:[_/-]|${end}))+)`) },
  };
}

/**
 * The allowlist, made ready to apply: for each attribute, the one pattern
 * (RE2 and JavaScript alike) its value, or each element of its list, must
 * match, and what else the allowlist says of it.
 *
 * @param {any} allowlist collector/allowlist.json with the catalog's sets
 */
export function compile(allowlist) {
  const sets = allowlist.sets ?? {};
  const named = allowlist.patterns ?? {};
  const members = (names) => [].concat(names ?? []).flatMap((name) => {
    if (!(name in sets)) throw new Error(`No set named ${name}.`);
    return sets[name];
  });
  for (const [name, kind] of Object.entries(allowlist.grows ?? {})) {
    if (!(name in sets)) throw new Error(`No set named ${name}.`);
    if (!Object.hasOwn(growthShapes, kind)) throw new Error(`No kind of set named ${kind}.`);
  }
  const words = wordPatterns(members(allowlist.vocabulary).flatMap((each) => nameWords(each)).filter((word) => word.length > 0));
  const publishedNames = new Set(members(allowlist.published));
  const publishedPattern = `^(?:${[...publishedNames].sort().map(escaped).join("|")})$`;
  const source = (spec) => {
    const parts = [];
    for (const value of [].concat(spec.values ?? [])) for (const each of sets[value] ?? [value]) parts.push(escaped(String(each)));
    if (spec.pattern) parts.push(unanchored(named[spec.pattern] ?? spec.pattern));
    return parts.length > 0 ? `^(?:${parts.join("|")})$` : undefined;
  };
  const attributes = (specs) => Object.entries(specs).map(([key, spec]) => {
    const pattern = source(spec);
    const extract = typeof spec.extract === "string" ? { "*": spec.extract } : spec.extract;
    return {
      key,
      ...spec,
      from: spec.from,
      pattern,
      test: pattern === undefined ? undefined : regExp(pattern),
      extract,
      extractTests: extract && Object.fromEntries(Object.entries(extract).map(([service, each]) => [service, regExp(each)])),
      wordsPattern: spec.words && words[spec.words][spec.type === "string[]" ? "list" : "scalar"],
      wordsTest: spec.words && regExp(words[spec.words][spec.type === "string[]" ? "list" : "scalar"]),
    };
  });
  const services = Object.fromEntries(Object.entries(allowlist.services).map(([service, { scope, spans, tools, kinds: required, requires }]) => {
    const names = spans.map((name) => (name === toolCall ? `${escaped(name)}(?: [\\s\\S]*)?` : escaped(name)));
    const namePattern = `^(?:${names.join("|")})$`;
    const own = tools === undefined ? undefined : members(tools);
    return [service, {
      scope,
      namePattern,
      names: regExp(namePattern),
      tools: own,
      toolPattern: own && `^(?:${own.map(escaped).join("|")})$`,
      ownTools: own && new Set(own),
      kinds: required?.map((name) => kinds[name]),
      requires: requires ?? [],
    }];
  }));
  const blocked = Object.entries(allowlist.blockedValues ?? {}).map(([what, pattern]) => ({ what, pattern, test: regExp(pattern) }));
  const versionPattern = named.version;
  return {
    services,
    resource: attributes(allowlist.resource),
    span: attributes(allowlist.span),
    blocked,
    versionPattern,
    version: regExp(versionPattern),
    published: publishedNames,
    publishedPattern,
    words,
    nameWords: regExp(words.name.scalar),
  };
}

/** The keyed hash ids are replaced by: equal inputs stay equal, and nothing without the key joins them to anything. */
export function keyedHash(key) {
  return (tag, value, length = 32) => createHash("sha256").update(`${key}:${tag}:${value}`).digest("hex").slice(0, length);
}

// OTLP JSON values, read into typed values and written back.

/** @returns {{ type: "string" | "int" | "double" | "bool" | "list" | "other", value?: any }} */
function read(value) {
  if (value === null || typeof value !== "object") return { type: "other" };
  if (typeof value.stringValue === "string") return { type: "string", value: value.stringValue };
  if ("intValue" in value) {
    const int = value.intValue;
    // An int64, as the collector reads one: a number past 2^53 has lost its digits already.
    if (typeof int === "number" && Number.isSafeInteger(int)) return { type: "int", value: BigInt(int) };
    if (typeof int === "string" && /^-?[0-9]{1,19}$/.test(int) && BigInt(int) >= -int64 && BigInt(int) < int64) return { type: "int", value: BigInt(int) };
    return { type: "other" };
  }
  if (typeof value.doubleValue === "number") return { type: "double", value: value.doubleValue };
  if (typeof value.boolValue === "boolean") return { type: "bool", value: value.boolValue };
  if (value.arrayValue && typeof value.arrayValue === "object") {
    const values = value.arrayValue.values ?? [];
    return Array.isArray(values) ? { type: "list", value: values.map(read) } : { type: "other" };
  }
  return { type: "other" };
}

function write({ type, value }) {
  switch (type) {
    case "string": return { stringValue: value };
    case "int": return { intValue: String(value) };
    case "double": return { doubleValue: value };
    case "bool": return { boolValue: value };
    default: return { arrayValue: value.length > 0 ? { values: value.map(write) } : {} };
  }
}

/**
 * One attribute as the rules keep it, or undefined when they drop it.
 *
 * @param {ReturnType<typeof compile>} rules
 * @param {any} spec the attribute's compiled entry
 * @param {ReturnType<typeof read>} value
 * @param {string} service
 * @param {{ hash?: (tag: string, value: string, length?: number) => string, week: bigint, why: (reason: string) => void }} options
 */
function keep(rules, spec, value, service, { hash, week: weekStart, why }) {
  if (spec.from && !spec.from.includes(service)) return why(`is not sent by ${service}`);
  let { type, value: v } = value;
  if (spec.type === "double" && type === "int") {
    type = "double";
    v = Number(v);
  }
  const wanted = spec.type === "string[]" ? "list" : spec.type;
  if (type !== wanted) return why(`is not a ${spec.type}`);
  let hit;
  if (!spec.hash && type === "string") {
    hit = rules.blocked.find((each) => each.test.test(v));
    if (hit) v = masked;
  }
  if (spec.extract) {
    const pattern = spec.extractTests[service] ?? spec.extractTests["*"];
    if (pattern === undefined) return why(`is not kept from ${service}`);
    v = v.replace(pattern, "$1");
  }
  if (type === "list") {
    const hit = v.find((each) => each.type === "string" && rules.blocked.some((blocked) => blocked.test.test(each.value)));
    if (hit) return why(`holds ${rules.blocked.find((blocked) => blocked.test.test(hit.value)).what}`);
  }
  if (type === "string" && spec.test && !spec.test.test(v)) {
    if (spec.otherwise === undefined) return why(hit ? `holds ${hit.what}` : "does not have its shape");
    v = spec.otherwise;
  }
  if (type === "string" && spec.wordsTest && !spec.wordsTest.test(wordForm(v))) {
    if (spec.otherwise === undefined) return why("holds a word the vocabulary does not have");
    v = spec.otherwise;
  }
  if (type === "int") {
    if (spec.min !== undefined && v < BigInt(spec.min)) return why(`is under ${spec.min}`);
    if (spec.buckets) {
      if (v < BigInt(spec.buckets[0])) return why(`is under ${spec.buckets[0]}`);
      v = BigInt([...spec.buckets].reverse().find((bound) => v >= BigInt(bound)));
    }
  }
  if (type === "double" && spec.min !== undefined && !(v >= spec.min)) return why(`is under ${spec.min}`);
  if (type === "double" && spec.whole) {
    if (!(v < longestMilliseconds)) return why("is longer than any span");
    v = Math.trunc(v);
  }
  if (type === "list") {
    if (spec.max !== undefined && v.length > spec.max) return why(`holds more than ${spec.max} elements`);
    if (v.some((each) => each.type !== "string")) return why("holds an element that is not a string");
    if (spec.published) {
      v = v.map((each) => (rules.published.has(each.value) ? each : { type: "string", value: spec.otherwise }));
    } else {
      if (spec.test && v.some((each) => !spec.test.test(each.value))) return why("holds an element without its shape");
      // The list as the JSON text the collector's String() makes of it, so both filters read the same text.
      if (spec.wordsTest && !spec.wordsTest.test(wordForm(JSON.stringify(v.map((each) => each.value))))) return why("holds a word the vocabulary does not have");
    }
  }
  if (spec.hash && hash) v = hash(spec.hash, `${weekStart}:${v}`);
  return { type, value: v };
}

/**
 * The attributes the rules keep, in their order, or undefined when two share
 * a key: a key given twice is how a value would slip past a rule that reads
 * only the first, so such a span is dropped whole.
 */
function keepAll(rules, specs, attributes, service, options, where) {
  if (attributes !== undefined && !Array.isArray(attributes)) return undefined;
  const seen = new Set();
  const kept = new Map();
  for (const entry of attributes ?? []) {
    if (entry === null || typeof entry !== "object" || typeof entry.key !== "string") return undefined;
    if (seen.has(entry.key)) return undefined;
    seen.add(entry.key);
    const spec = specs.find((each) => each.key === entry.key);
    const why = (reason) => { options.report(`${where}: ${entry.key} ${reason}`); return undefined; };
    if (spec === undefined) {
      why("is not in the allowlist");
      continue;
    }
    const value = keep(rules, spec, read(entry.value), service, { ...options, why });
    if (value !== undefined) kept.set(entry.key, value);
  }
  for (const spec of specs) {
    if (spec.default !== undefined && !kept.has(spec.key) && (!spec.from || spec.from.includes(service))) kept.set(spec.key, { type: "string", value: spec.default });
  }
  for (const spec of specs) {
    if (!spec.beside || !kept.has(spec.key)) continue;
    const other = specs.find((each) => each.key === spec.beside);
    const value = kept.get(spec.beside)?.value;
    if (value === undefined || value === other?.otherwise) {
      kept.delete(spec.key);
      options.report(`${where}: ${spec.key} is kept only beside a ${spec.beside} the allowlist knows`);
    }
  }
  for (const spec of specs) {
    if (!spec.when || !kept.has(spec.key)) continue;
    if (Object.entries(spec.when).some(([key, value]) => kept.get(key)?.value !== value)) {
      kept.delete(spec.key);
      options.report(`${where}: ${spec.key} is kept only beside ${Object.entries(spec.when).map(([key, value]) => `${key} ${value}`).join(", ")}`);
    }
  }
  return kept;
}

const hex = (text, length) => typeof text === "string" && new RegExp(`^[0-9a-fA-F]{${length}}$`).test(text) && !/^0+$/.test(text);

function nanos(value) {
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  return value === undefined ? 0n : undefined;
}

function enumValue(value, names) {
  if (value === undefined) return 0;
  if (typeof value === "string") return names.indexOf(value);
  return Number.isInteger(value) ? value : -1;
}

/** The Monday at midnight UTC of the week a time falls in. */
const weekOf = (start) => start - ((((start - monday) % week) + week) % week);

/**
 * The tool's name, whose it is, and the names that go with it, as the rules
 * keep them: names only of tools a project publishes, or that MCP answered
 * for and that are made of the vocabulary's words.
 */
function keepNames(rules, attributes, service, kind) {
  const names = rules.span.filter((spec) => spec.name);
  const tool = attributes.get(toolKey);
  const published = tool !== undefined && rules.published.has(tool.value);
  if (service === "pharo-mcp") {
    const origin = attributes.get(originKey)?.value;
    if (tool !== undefined && !published && (origin === "other" || !rules.nameWords.test(wordForm(tool.value)))) attributes.set(toolKey, { type: "string", value: "_OTHER" });
    if (origin === "other" && !published) {
      for (const spec of rules.span.filter((each) => each.own)) attributes.delete(spec.key);
      for (const spec of names) {
        if (!attributes.has(spec.key)) continue;
        if (spec.nameOther === undefined) attributes.delete(spec.key);
        else attributes.set(spec.key, { type: "string", value: spec.nameOther });
      }
    }
  }
  const { ownTools } = rules.services[service];
  if (ownTools) {
    if (tool !== undefined && !published) attributes.set(toolKey, { type: "string", value: "_OTHER" });
    const own = tool !== undefined && ownTools.has(tool.value);
    const forwarded = attributes.get(forwardedKey)?.value === true || kind === clientKind || !own;
    if (forwarded) for (const spec of names) if (!spec.tool) attributes.delete(spec.key);
  }
}

/**
 * One span as the rules keep it, or undefined when they drop it.
 *
 * @param {ReturnType<typeof compile>} rules
 */
function keepSpan(rules, span, service, options) {
  const where = `span ${typeof span?.name === "string" ? span.name : "?"}`;
  const drop = (reason) => { options.report(`${where}: ${reason}`); return undefined; };
  if (span === null || typeof span !== "object") return drop("is not a span");
  const rulesOf = rules.services[service];
  if (typeof span.name !== "string" || !rulesOf.names.test(span.name)) return drop("is not an operation of ours");
  if (Array.isArray(span.links) && span.links.length > 0) return drop("has links");
  if (!hex(span.traceId, 32) || !hex(span.spanId, 16)) return drop("has no valid ids");
  const root = span.parentSpanId === undefined || span.parentSpanId === "" || /^0{16}$/.test(span.parentSpanId);
  if (!root && !hex(span.parentSpanId, 16)) return drop("has no valid parent id");
  const start = nanos(span.startTimeUnixNano);
  const end = nanos(span.endTimeUnixNano);
  // Before the first Monday of 1970 a week would start before the epoch; from 2^63 a time is no int64.
  if (start === undefined || end === undefined || start < monday || end < start || end >= int64) return drop("has no valid times");
  const kind = enumValue(span.kind, kindNames);
  if (kind < 0 || kind > 5) return drop("has no valid kind");
  if (rulesOf.kinds && !rulesOf.kinds.includes(kind)) return drop(`is not a ${kindNames[kind]} span`);
  const status = enumValue(span.status?.code, statusNames);
  if (status < 0 || status > 2) return drop("has no valid status");
  const day = weekOf(start);

  const attributes = keepAll(rules, rules.span, span.attributes, service, { ...options, week: day }, where);
  if (attributes === undefined) return drop("gives an attribute twice");
  for (const key of rulesOf.requires) if (!attributes.has(key)) return drop(`has no ${key}`);
  keepNames(rules, attributes, service, kind);
  let name = span.name;
  if (name === toolCall || name.startsWith(`${toolCall} `)) {
    const tool = attributes.get(toolKey);
    name = tool?.type === "string" ? `${toolCall} ${tool.value}` : toolCall;
  }
  const session = attributes.get(sessionKey)?.value;
  // A place in a session means nothing without the session.
  if (session === undefined) attributes.delete(offsetKey);
  else if (options.sessionOffset) attributes.set(offsetKey, { type: "int", value: options.sessionOffset(session, start) });
  if (end > start) attributes.set("span.duration_ms", { type: "double", value: Number((end - start) / 1_000_000n) });
  else if (!attributes.has("span.duration_ms")) attributes.set("span.duration_ms", { type: "double", value: 0 });

  // Ids hash within their session and week: a caller's constant trace context links no two sessions.
  const id = (tag, value, length) => (options.hash ? options.hash(tag, `${day}:${session ?? ""}:${value.toLowerCase()}`, length) : value.toLowerCase());
  return {
    traceId: id("trace", span.traceId, 32),
    spanId: id("span", span.spanId, 16),
    ...(root ? {} : { parentSpanId: id("span", span.parentSpanId, 16) }),
    name,
    kind,
    startTimeUnixNano: String(day),
    endTimeUnixNano: String(day),
    attributes: [...attributes].map(([key, value]) => ({ key, value: write(value) })),
    status: status === 0 ? {} : { code: status },
  };
}

/**
 * A traces export request as the rules keep it: only PLexus's and MCP's
 * spans, each attribute in its shape, names only where they may be kept,
 * times to the week with each duration kept, ids hashed; or null when
 * nothing is left, or the request is not one.
 *
 * @param {ReturnType<typeof compile>} rules
 * @param {any} request an OTLP JSON ExportTraceServiceRequest
 * @param {{
 *   hash?: (tag: string, value: string, length?: number) => string,
 *   report?: (problem: string) => void,
 *   sessionOffset?: (session: string, start: bigint) => bigint,
 * }} [options]
 *   without `hash`, ids and session ids are kept as they are, as `npm run audit` reads an archive;
 *   with `sessionOffset`, each span with a session gets its offset in it, as the agent adds it
 */
export function transformTraces(rules, request, options = {}) {
  const settings = { hash: options.hash, report: options.report ?? (() => {}), sessionOffset: options.sessionOffset };
  if (request === null || typeof request !== "object" || !Array.isArray(request.resourceSpans)) return null;
  const resourceSpans = [];
  for (const each of request.resourceSpans) {
    const attributes = each?.resource?.attributes;
    const service = Array.isArray(attributes) ? attributes.find((entry) => entry?.key === "service.name")?.value?.stringValue : undefined;
    if (!Object.hasOwn(rules.services, service)) {
      settings.report(`resource: service.name ${service === undefined ? "is missing" : `${JSON.stringify(service)} is not ours`}`);
      continue;
    }
    const resource = keepAll(rules, rules.resource, attributes, service, settings, "resource");
    if (resource === undefined) {
      settings.report("resource: gives an attribute twice");
      continue;
    }
    const scopeSpans = [];
    for (const scoped of Array.isArray(each.scopeSpans) ? each.scopeSpans : []) {
      if (scoped?.scope?.name !== rules.services[service].scope) {
        settings.report(`scope ${scoped?.scope?.name ?? "?"} is not ${service}'s`);
        continue;
      }
      if ((scoped.scope.attributes ?? []).length > 0) settings.report("a scope keeps attributes");
      const version = scoped.scope.version;
      const spans = (Array.isArray(scoped.spans) ? scoped.spans : []).map((span) => keepSpan(rules, span, service, settings)).filter(Boolean);
      if (spans.length === 0) continue;
      scopeSpans.push({
        scope: { name: scoped.scope.name, ...(typeof version === "string" && rules.version.test(version) ? { version } : {}) },
        spans,
      });
    }
    if (scopeSpans.length === 0) continue;
    resourceSpans.push({
      resource: { attributes: [...resource].map(([key, value]) => ({ key, value: write(value) })) },
      scopeSpans,
    });
  }
  return resourceSpans.length === 0 ? null : { resourceSpans };
}

/** How many sessions the agent remembers the first span of, and how long after its last span. */
export const sessionMemory = { sessions: 10_000, idle: 3_600_000 };

/**
 * Where each span comes in its session: milliseconds from the first span of
 * that session the agent saw, negative for one that started before it. A
 * session is forgotten an hour after its last span, the oldest first past
 * the cap. `sessions` is kept in the order of their last span, so the ones
 * to forget are always first: a new session costs no scan of the others.
 * The agent gives the map it keeps across its restarts.
 *
 * @param {() => number} [now]
 * @param {Map<string, { first: bigint, seen: number }>} [sessions] hashed session ids, by last span
 */
export function sessionOffsets(now = Date.now, sessions = new Map()) {
  return (session, start) => {
    const at = now();
    let entry = sessions.get(session);
    if (entry === undefined || at - entry.seen > sessionMemory.idle) {
      entry = { first: start, seen: at };
      for (const [each, { seen }] of sessions) {
        if (at - seen <= sessionMemory.idle && sessions.size < sessionMemory.sessions) break;
        sessions.delete(each);
      }
    }
    entry.seen = at;
    sessions.delete(session);
    sessions.set(session, entry);
    return (start - entry.first) / 1_000_000n;
  };
}

/** The form of catalog these rules read: a catalog of another form is refused, never guessed at. */
export const catalogSchema = 1;

/** The most members a catalog adds to a set. */
export const catalogAdditionCap = 2_000;

/** The shape of a member a catalog adds, by the kind of set it grows: a tool's name, a word, a code, a class. */
const growthShapes = {
  tool: /^[a-z][a-z0-9_]{0,63}$/,
  word: /^[a-z0-9]{1,24}$/,
  code: /^[a-z][a-z0-9]{0,23}(?:-[a-z0-9]{1,24}){0,5}$/,
  class: /^[A-Z][A-Za-z0-9]{0,63}$/,
};

/** A catalog's date: UTC, to the second or the millisecond, of a day that exists. */
const catalogDateShape = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;

/** The time a catalog's date names, in milliseconds, or undefined when it is not a date of that shape. */
export function catalogTime(date) {
  if (typeof date !== "string" || !catalogDateShape.test(date)) return undefined;
  const time = Date.parse(date);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 19) !== date.slice(0, 19) ? undefined : time;
}

/**
 * Why these rules cannot read a catalog at all, or undefined when they can:
 * it must be of their form, dated, and give its sets as an object. What its
 * sets hold is sorted member by member (catalogAdditions).
 *
 * @param {any} catalog `{ schema, published, releases, sets }`
 */
export function catalogProblem(catalog) {
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) return "it is not an object";
  if (catalog.schema !== catalogSchema) return `it is of form ${JSON.stringify(catalog.schema)}, and this agent reads form ${catalogSchema}`;
  if (catalogTime(catalog.published) === undefined) return "its date is not a UTC date of the form 2026-11-23T10:00:00Z";
  if (catalog.sets === null || typeof catalog.sets !== "object" || Array.isArray(catalog.sets)) return "it has no sets";
  return undefined;
}

/** Whether a member may be added to a set of `kind`: of its shape, and no value the allowlist blocks. */
export function addable(allowlist, kind, member) {
  return typeof member === "string" && growthShapes[kind].test(member) && !Object.values(allowlist.blockedValues ?? {}).some((pattern) => regExp(pattern).test(member));
}

/**
 * What a catalog adds to the sets that grow with the projects' releases (the
 * allowlist's `grows`: their tools, words, codes and exception classes):
 * the members of the set's shape the allowlist does not have yet, at most
 * catalogAdditionCap a set. Any other member is left out on its own, and so
 * is every other set: a catalog never removes a member, nor adds to the
 * agent hosts or any other set, nor changes which attributes are kept or in
 * what shape. The rules stay this code.
 *
 * @param {any} allowlist
 * @param {any} catalog
 * @returns {Record<string, string[]>}
 */
export function catalogAdditions(allowlist, catalog) {
  /** @type {Record<string, string[]>} */
  const added = {};
  for (const [name, kind] of Object.entries(allowlist.grows ?? {})) {
    const given = catalog?.sets?.[name];
    if (!Array.isArray(given)) continue;
    const have = new Set(allowlist.sets?.[name] ?? []);
    const members = new Set();
    for (const member of given) {
      if (members.size >= catalogAdditionCap) break;
      if (!have.has(member) && addable(allowlist, kind, member)) members.add(member);
    }
    if (members.size > 0) added[name] = [...members];
  }
  return added;
}

/** The members of a catalog's sets that agents would leave out: of a set that does not grow, or not of its set's shape. */
export function catalogLeftOut(allowlist, catalog) {
  return Object.entries(catalog?.sets ?? {}).flatMap(([name, members]) => {
    const kind = allowlist.grows?.[name];
    if (kind === undefined) return [`${name} (a set no catalog adds to)`];
    return (Array.isArray(members) ? members : [members]).filter((member) => !addable(allowlist, kind, member)).map((member) => `${name}: ${JSON.stringify(member)}`);
  });
}

/** The allowlist with what a catalog adds to its sets. */
export function withCatalogSets(allowlist, catalog) {
  const added = catalogAdditions(allowlist, catalog);
  const sets = Object.fromEntries(Object.entries(added).map(([name, members]) => [name, [...allowlist.sets[name], ...members]]));
  return { ...allowlist, catalogPublished: catalog.published, releases: catalog.releases, sets: { ...allowlist.sets, ...sets } };
}

/**
 * The function the agent calls before it sends anything: traces as the rules
 * keep them, each span with its place in its session, and nothing of the
 * other signals, which the collector does not take. Without a key, nothing is
 * sent: ids are never sent unhashed.
 *
 * @param {any} allowlist
 * @param {string | undefined} key
 * @param {{ offsets?: boolean, sessions?: Map<string, { first: bigint, seen: number }>, catalog?: any }} [options] `offsets: false` leaves out the places, as the collector, which cannot know them; `sessions`, the first span of each session the agent saw, which it keeps across its restarts; `catalog`, a newer catalog the agent accepted (catalogProblem finds nothing in it), whose additions the sets take
 */
export function createTransform(allowlist, key, { offsets = true, sessions, catalog } = {}) {
  if (catalog !== undefined && catalogProblem(catalog)) throw new Error(`The catalog is refused: ${catalogProblem(catalog)}.`);
  const rules = compile(catalog === undefined ? allowlist : withCatalogSets(allowlist, catalog));
  const hash = typeof key === "string" && /^[0-9a-f]{32,128}$/.test(key) ? keyedHash(key) : undefined;
  const sessionOffset = offsets ? sessionOffsets(Date.now, sessions) : undefined;
  return (signal, request) => {
    if (signal !== "traces" || hash === undefined) return null;
    try {
      return transformTraces(rules, request, { hash, sessionOffset });
    } catch {
      return null;
    }
  };
}
