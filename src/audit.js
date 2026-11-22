// Reads what the collector archived and says whether it holds only what the
// rules keep: the check to run on a deployed collector's archive, as the DPO
// may ask, and on any archive a change to the tools produced. It applies the
// rules again, ids aside, and names whatever they would drop or change.
import { compile, regExp, transformTraces } from "./rules.js";

/** A blocked-value pattern of the allowlist, in Go's syntax, as a JavaScript RegExp. */
export const blockedPattern = regExp;

/** The resource attribute the collector adds to name each day's file: the archive's own, never imported. */
export const archiveAttribute = "fileexporter.path_segment";

/** The fields each level of an archived request may have: anything else came through without a rule, such as a resource's entity references. */
const fields = {
  resourceSpans: ["resource", "scopeSpans", "schemaUrl"],
  resource: ["attributes", "droppedAttributesCount"],
  scopeSpans: ["scope", "spans", "schemaUrl"],
  scope: ["name", "version", "attributes", "droppedAttributesCount"],
  span: ["traceId", "spanId", "parentSpanId", "name", "kind", "startTimeUnixNano", "endTimeUnixNano", "attributes", "status", "traceState", "flags", "events", "links", "droppedAttributesCount", "droppedEventsCount", "droppedLinksCount"],
  status: ["code", "message"],
};
const unknown = (object, level) => Object.keys(object ?? {}).filter((key) => !fields[level].includes(key));

const valueText = (value) => JSON.stringify(value && "intValue" in value ? { intValue: String(value.intValue) } : value);
const byKey = (attributes) => new Map((attributes ?? []).map(({ key, value }) => [key, valueText(value)]));

/**
 * Every span of the archive's lines, and what in them the rules would not
 * have kept as it is.
 *
 * @param {string[]} lines OTLP JSON export requests, one per line
 * @param {any} allowlist collector/allowlist.json
 */
export function audit(lines, allowlist) {
  const rules = compile(allowlist);
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, number>} */
  const spans = new Map();
  /** @type {Set<string>} */
  const keys = new Set();
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const at = `line ${index + 1}`;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      problems.push(`${at} is not JSON`);
      return;
    }
    for (const resourceSpans of request.resourceSpans ?? []) {
      const attributes = resourceSpans.resource?.attributes ?? [];
      for (const { key, value } of attributes) {
        if (key === archiveAttribute) {
          if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value?.stringValue ?? "")) problems.push(`${at} resource: ${archiveAttribute} is not a day`);
        } else {
          keys.add(key);
        }
      }
      const resource = attributes.filter(({ key }) => key !== archiveAttribute);
      const service = resource.find(({ key }) => key === "service.name")?.value?.stringValue ?? "?";
      if (resourceSpans.schemaUrl) problems.push(`${at} resource: a schema URL is kept`);
      for (const key of unknown(resourceSpans, "resourceSpans")) problems.push(`${at} resource: ${key} is kept`);
      for (const key of unknown(resourceSpans.resource, "resource")) problems.push(`${at} resource: ${key} is kept`);
      /** @type {string[]} */
      const reported = [];
      const kept = transformTraces(rules, { resourceSpans: [{ ...resourceSpans, resource: { attributes: resource } }] }, { report: (problem) => reported.push(`${at} ${problem}`) });
      problems.push(...reported);
      const mentioned = (where, key) => reported.some((problem) => problem.startsWith(`${at} ${where}`) && problem.includes(`: ${key} `));
      const differences = (where, before, after) => {
        const was = byKey(before);
        const is = byKey(after);
        for (const [key, value] of was) {
          if (mentioned(where, key)) continue;
          if (!is.has(key)) problems.push(`${at} ${where}: ${key} would be dropped`);
          else if (is.get(key) !== value) problems.push(`${at} ${where}: ${key} holds a value the rules would change`);
        }
        for (const key of is.keys()) if (!was.has(key)) problems.push(`${at} ${where}: ${key} is missing`);
      };
      const out = kept?.resourceSpans[0];
      if (out) differences("resource", resource, out.resource.attributes);
      // Each span is set beside what the rules make of it alone: two spans of a line may share an id.
      const alone = (scopeSpans, span) => {
        const each = transformTraces(rules, { resourceSpans: [{ resource: { attributes: resource }, scopeSpans: [{ ...scopeSpans, spans: [span] }] }] })?.resourceSpans[0]?.scopeSpans[0];
        return each && { scope: each.scope, span: each.spans[0] };
      };
      for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
        if (scopeSpans.schemaUrl) problems.push(`${at} scope: a schema URL is kept`);
        for (const key of [...unknown(scopeSpans, "scopeSpans"), ...unknown(scopeSpans.scope, "scope")]) problems.push(`${at} scope: ${key} is kept`);
        for (const span of scopeSpans.spans ?? []) {
          const where = `span ${span.name}`;
          spans.set(`${service} ${span.name}`, (spans.get(`${service} ${span.name}`) ?? 0) + 1);
          for (const { key } of span.attributes ?? []) keys.add(key);
          if ((span.events ?? []).length > 0) problems.push(`${at} ${where}: events are kept`);
          if (span.traceState) problems.push(`${at} ${where}: a trace state is kept`);
          if (span.status?.message) problems.push(`${at} ${where}: a status message is kept`);
          if (span.flags) problems.push(`${at} ${where}: flags are kept`);
          for (const key of [...unknown(span, "span"), ...unknown(span.status, "status")]) problems.push(`${at} ${where}: ${key} is kept`);
          const after = alone(scopeSpans, span);
          if (after === undefined) continue;
          if (after.scope.version !== scopeSpans.scope?.version) problems.push(`${at} ${where}: the scope's version is not a version`);
          if (after.span.name !== span.name) problems.push(`${at} ${where}: the name is not what the rules make of it`);
          if (after.span.startTimeUnixNano !== String(span.startTimeUnixNano) || after.span.endTimeUnixNano !== String(span.endTimeUnixNano)) {
            problems.push(`${at} ${where}: its times are not its week's`);
          }
          differences(where, span.attributes, after.span.attributes);
        }
      }
    }
  });
  return { spans, keys, problems };
}
