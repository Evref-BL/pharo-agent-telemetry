// What the rule fixtures share: the key both filters hash with in the tests,
// and one form of a span to compare what the agent's filter and the
// collector keep with what each fixture expects.
import { createHash } from "node:crypto";
import fs from "node:fs";

/** The key the tests give the agent's filter and the collector alike. */
export const testKey = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/** The keyed hash, written again here so that the tests check it. */
export const hash = (tag, value, length = 32) => createHash("sha256").update(`${testKey}:${tag}:${value}`).digest("hex").slice(0, length);

const fixtures = new URL("./fixtures/rules/", import.meta.url);

/** Every rule fixture: what it shows, the request, and the spans the rules keep of it. */
export function ruleFixtures() {
  return fs.readdirSync(fixtures).filter((name) => name.endsWith(".json")).sort().map((name) => ({
    name: name.replace(/\.json$/, ""),
    ...JSON.parse(fs.readFileSync(new URL(name, fixtures), "utf8")),
  }));
}

/** An OTLP JSON value, compactly: strings, numbers for integers, { double }, booleans, lists. */
function compact(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return Number(value.intValue);
  if ("doubleValue" in value) return { double: value.doubleValue };
  if ("boolValue" in value) return value.boolValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(compact);
  return { other: value };
}

const object = (attributes, skip = []) => Object.fromEntries((attributes ?? []).filter(({ key }) => !skip.includes(key)).map(({ key, value }) => [key, compact(value)]));

/**
 * The spans of OTLP JSON requests in one comparable form, sorted by span id.
 * The collector's day of arrival, which names the archive's file, is left out.
 */
export function comparable(requests) {
  return requests.flatMap((request) => (request?.resourceSpans ?? []).flatMap((resourceSpans) =>
    (resourceSpans.scopeSpans ?? []).flatMap((scopeSpans) => (scopeSpans.spans ?? []).map((span) => ({
      resource: object(resourceSpans.resource?.attributes, ["fileexporter.path_segment"]),
      scope: scopeSpans.scope?.name,
      ...(scopeSpans.scope?.version ? { scopeVersion: scopeSpans.scope.version } : {}),
      name: span.name,
      kind: span.kind,
      trace: span.traceId,
      span: span.spanId,
      ...(span.parentSpanId ? { parent: span.parentSpanId } : {}),
      start: String(span.startTimeUnixNano),
      end: String(span.endTimeUnixNano),
      status: span.status?.code ?? 0,
      attributes: object(span.attributes),
      ...(span.events?.length ? { events: span.events } : {}),
      ...(span.links?.length ? { links: span.links } : {}),
      ...(span.traceState ? { traceState: span.traceState } : {}),
      ...(span.flags ? { flags: span.flags } : {}),
      ...(span.status?.message ? { statusMessage: span.status.message } : {}),
    }))))).sort((a, b) => a.span.localeCompare(b.span));
}

/** The Monday of the week a time in nanoseconds falls in, as the rules keep a start. */
export function weekOf(nanos) {
  const week = 604_800_000_000_000n;
  const monday = 345_600_000_000_000n;
  const start = BigInt(nanos);
  return String(start - ((((start - monday) % week) + week) % week));
}

/** A trace id as both filters hash it, within its session (as sent) and the week of `start`. */
export function hashedTrace(traceId, start, session) {
  const week = weekOf(start);
  return hash("trace", `${week}:${session === undefined ? "" : hash("session", `${week}:${session}`)}:${traceId.toLowerCase()}`, 32);
}

/**
 * A fixture's expected spans in the comparable form, with the test key: the
 * session id hashed within its week, and the ids within their session and
 * week.
 */
export function expectedSpans(fixture) {
  return fixture.expected.map((span) => {
    const raw = span.attributes["session.id"];
    const session = raw === undefined ? undefined : hash("session", `${span.start}:${raw}`, 32);
    const id = (tag, value, length) => hash(tag, `${span.start}:${session ?? ""}:${value.toLowerCase()}`, length);
    return {
      ...span,
      trace: id("trace", span.trace, 32),
      span: id("span", span.span, 16),
      ...(span.parent ? { parent: id("span", span.parent, 16) } : {}),
      end: span.start,
      status: span.status ?? 0,
      attributes: Object.fromEntries(Object.entries(span.attributes).map(([key, value]) => [key, key === "session.id" ? session : value])),
    };
  }).sort((a, b) => a.span.localeCompare(b.span));
}
