// Reads what the collector archived and says whether it holds only what the
// allowlist allows: the check to run on a deployed collector's archive, as
// the DPO may ask, and on any archive a change to the tools produced.
import { longestValue, spanNamePattern } from "./generate.js";

/** A blocked-value pattern of the allowlist, in Go's syntax, as a JavaScript RegExp. */
export function blockedPattern(pattern) {
  const flags = /^\(\?([a-z]+)\)/.exec(pattern);
  return new RegExp(flags ? pattern.slice(flags[0].length) : pattern, flags ? flags[1] : "");
}

const textOf = (value) =>
  value.stringValue ??
  (value.arrayValue ? (value.arrayValue.values ?? []).map(textOf).join(",") : String(value.intValue ?? value.doubleValue ?? value.boolValue ?? ""));

/**
 * Every span of the archive's lines, and what in them the collector should
 * not have kept.
 *
 * @param {string[]} lines OTLP JSON export requests, one per line
 * @param {{ resource: Record<string, string>, span: Record<string, string>, blockedValues: Record<string, string> }} allowlist
 */
export function audit(lines, allowlist) {
  const blocked = Object.entries(allowlist.blockedValues).map(([what, pattern]) => [what, blockedPattern(pattern)]);
  const names = new RegExp(spanNamePattern);
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, number>} */
  const spans = new Map();
  /** @type {Set<string>} */
  const keys = new Set();
  const check = (where, attributes, allowed) => {
    for (const { key, value } of attributes ?? []) {
      keys.add(key);
      if (!(key in allowed)) problems.push(`${where}: ${key} is not in the allowlist`);
      const text = textOf(value);
      if (value.stringValue !== undefined && text.length > longestValue) problems.push(`${where}: ${key} is longer than ${longestValue}`);
      for (const [what, pattern] of blocked) if (pattern.test(text)) problems.push(`${where}: ${key} holds ${what}`);
    }
  };
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      problems.push(`line ${index + 1} is not JSON`);
      return;
    }
    for (const resourceSpans of request.resourceSpans ?? []) {
      const attributes = resourceSpans.resource?.attributes ?? [];
      const service = attributes.find((each) => each.key === "service.name")?.value?.stringValue ?? "?";
      check(`line ${index + 1} resource`, attributes, allowlist.resource);
      for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
        if ((scopeSpans.scope?.attributes ?? []).length > 0) problems.push(`line ${index + 1}: a scope keeps attributes`);
        for (const span of scopeSpans.spans ?? []) {
          const where = `line ${index + 1} span ${span.name}`;
          spans.set(`${service} ${span.name}`, (spans.get(`${service} ${span.name}`) ?? 0) + 1);
          if (span.name !== "_OTHER" && !names.test(span.name)) problems.push(`${where}: the name is not an operation`);
          if ((span.events ?? []).length > 0) problems.push(`${where}: events are kept`);
          if (span.status?.message) problems.push(`${where}: a status message is kept`);
          if (span.traceState) problems.push(`${where}: a trace state is kept`);
          check(where, span.attributes, allowlist.span);
        }
      }
    }
  });
  return { spans, keys, problems };
}
