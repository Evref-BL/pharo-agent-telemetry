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

/** A week in nanoseconds, and a Monday at midnight UTC: times are kept to the week they fall in. */
const week = 604_800_000_000_000n;
const monday = 345_600_000_000_000n;

/** What a value that holds an address, a path or an email becomes before its shape is checked. */
export const masked = "****";

/** The operation a span named `tools/call <tool>` performed; the tool after it is the span's gen_ai.tool.name. */
export const toolCall = "tools/call";

/** A pattern written for Go's RE2 as a JavaScript RegExp: a leading `(?flags)` becomes the RegExp's flags. */
export function regExp(pattern) {
  const flags = /^\(\?([a-z]+)\)/.exec(pattern);
  return new RegExp(flags ? pattern.slice(flags[0].length) : pattern, flags ? flags[1] : "");
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unanchored = (pattern) => pattern.replace(/^\^/, "").replace(/\$$/, "");

/**
 * The allowlist, made ready to apply: for each attribute, the one pattern
 * (RE2 and JavaScript alike) its value, or each element of its list, must
 * match, and what else the allowlist says of it.
 *
 * @param {any} allowlist collector/allowlist.json
 */
export function compile(allowlist) {
  const sets = allowlist.sets ?? {};
  const named = allowlist.patterns ?? {};
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
    };
  });
  const services = Object.fromEntries(Object.entries(allowlist.services).map(([service, { scope, spans, tools }]) => {
    const names = spans.map((name) => (name === toolCall ? `${escaped(name)}(?: [\\s\\S]*)?` : escaped(name)));
    const namePattern = `^(?:${names.join("|")})$`;
    return [service, {
      scope,
      namePattern,
      names: regExp(namePattern),
      tools,
      toolPattern: tools && `^(?:${tools.map(escaped).join("|")})$`,
      ownTools: tools && new Set(tools),
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
    if (typeof int === "number" && Number.isInteger(int)) return { type: "int", value: BigInt(int) };
    if (typeof int === "string" && /^-?[0-9]{1,19}$/.test(int)) return { type: "int", value: BigInt(int) };
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
 * @param {{ hash?: (tag: string, value: string, length?: number) => string, why: (reason: string) => void }} options
 */
function keep(rules, spec, value, service, { hash, why }) {
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
  if (type === "int") {
    if (spec.min !== undefined && v < BigInt(spec.min)) return why(`is under ${spec.min}`);
    if (spec.buckets) {
      if (v < BigInt(spec.buckets[0])) return why(`is under ${spec.buckets[0]}`);
      v = BigInt([...spec.buckets].reverse().find((bound) => v >= BigInt(bound)));
    }
  }
  if (type === "double" && spec.min !== undefined && !(v >= spec.min)) return why(`is under ${spec.min}`);
  if (type === "list") {
    if (spec.max !== undefined && v.length > spec.max) return why(`holds more than ${spec.max} elements`);
    if (v.some((each) => each.type !== "string" || (spec.test && !spec.test.test(each.value)))) return why("holds an element without its shape");
  }
  if (spec.hash && hash) v = hash(spec.hash, v);
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

/** Microseconds as milliseconds, as OTTL computes them: Double(Microseconds(duration)) / 1000.0. */
const milliseconds = (duration) => Number(duration / 1000n) / 1000;

/**
 * One span as the rules keep it, or undefined when they drop it.
 *
 * @param {ReturnType<typeof compile>} rules
 */
function keepSpan(rules, span, service, options) {
  const where = `span ${typeof span?.name === "string" ? span.name : "?"}`;
  const drop = (reason) => { options.report(`${where}: ${reason}`); return undefined; };
  if (span === null || typeof span !== "object") return drop("is not a span");
  if (typeof span.name !== "string" || !rules.services[service].names.test(span.name)) return drop("is not an operation of ours");
  if (Array.isArray(span.links) && span.links.length > 0) return drop("has links");
  if (!hex(span.traceId, 32) || !hex(span.spanId, 16)) return drop("has no valid ids");
  const root = span.parentSpanId === undefined || span.parentSpanId === "" || /^0{16}$/.test(span.parentSpanId);
  if (!root && !hex(span.parentSpanId, 16)) return drop("has no valid parent id");
  const start = nanos(span.startTimeUnixNano);
  const end = nanos(span.endTimeUnixNano);
  if (start === undefined || end === undefined || start <= 0n || end < start) return drop("has no valid times");
  const kind = enumValue(span.kind, kindNames);
  if (kind < 0 || kind > 5) return drop("has no valid kind");
  const status = enumValue(span.status?.code, statusNames);
  if (status < 0 || status > 2) return drop("has no valid status");

  const attributes = keepAll(rules, rules.span, span.attributes, service, options, where);
  if (attributes === undefined) return drop("gives an attribute twice");
  const names = rules.span.filter((spec) => spec.name);
  if (service === "pharo-mcp" && attributes.get("pharo.mcp.tool.origin")?.value === "other") {
    for (const spec of names) {
      if (!attributes.has(spec.key)) continue;
      if (spec.nameOther === undefined) attributes.delete(spec.key);
      else attributes.set(spec.key, { type: "string", value: spec.nameOther });
    }
  }
  const { ownTools } = rules.services[service];
  if (ownTools) {
    const tool = attributes.get("gen_ai.tool.name");
    const forwarded = attributes.get("plexus.call.forwarded")?.value === true || kind === clientKind || (tool !== undefined && !ownTools.has(tool.value));
    if (forwarded) for (const spec of names) attributes.delete(spec.key);
  }
  let name = span.name;
  if (name === toolCall || name.startsWith(`${toolCall} `)) {
    const tool = attributes.get("gen_ai.tool.name");
    name = tool?.type === "string" ? `${toolCall} ${tool.value}` : toolCall;
  }
  if (end > start) attributes.set("span.duration_ms", { type: "double", value: milliseconds(end - start) });
  else if (!attributes.has("span.duration_ms")) attributes.set("span.duration_ms", { type: "double", value: 0 });
  const day = start - ((((start - monday) % week) + week) % week);

  const id = (tag, value, length) => (options.hash ? options.hash(tag, value.toLowerCase(), length) : value.toLowerCase());
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
 * spans, each attribute in its shape, names only where the image may report
 * them, times to the week with each duration kept, ids hashed; or null when
 * nothing is left, or the request is not one.
 *
 * @param {ReturnType<typeof compile>} rules
 * @param {any} request an OTLP JSON ExportTraceServiceRequest
 * @param {{ hash?: (tag: string, value: string, length?: number) => string, report?: (problem: string) => void }} [options]
 *   without `hash`, ids and session ids are kept as they are, as `npm run audit` reads an archive
 */
export function transformTraces(rules, request, options = {}) {
  const settings = { hash: options.hash, report: options.report ?? (() => {}) };
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

/**
 * The function PLexus calls before it sends anything: traces as the rules
 * keep them, and nothing of the other signals, which the collector does not
 * take. Without a key, nothing is sent: ids are never sent unhashed.
 *
 * @param {any} allowlist
 * @param {string | undefined} key
 */
export function createTransform(allowlist, key) {
  const rules = compile(allowlist);
  const hash = typeof key === "string" && /^[0-9a-f]{32,128}$/.test(key) ? keyedHash(key) : undefined;
  return (signal, request) => {
    if (signal !== "traces" || hash === undefined) return null;
    try {
      return transformTraces(rules, request, { hash });
    } catch {
      return null;
    }
  };
}
