// The agent's filter against the rule fixtures. collector.test.js sends the
// same fixtures through the collector and requires the same spans, so the
// two filters agree.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { filter } from "../src/telemetry-transform.mjs";
import { compile, createTransform, offsetKey, sessionMemory, sessionOffsets, transformTraces } from "../src/rules.js";
import { readAllowlist } from "../src/generate.js";
import { comparable, expectedSpans, ruleFixtures, testKey } from "./support.js";

const root = new URL("..", import.meta.url).pathname;
const allowlist = readAllowlist(root);
// The places in sessions are the agent's alone, which the collector cannot know: a test of their own checks them.
const transform = filter(testKey, { offsets: false });

for (const fixture of ruleFixtures()) {
  test(`the agent's filter: ${fixture.name}: ${fixture.about}`, () => {
    assert.deepEqual(comparable([transform("traces", fixture.request)]), expectedSpans(fixture));
  });
}

test("applying the rules again, ids aside, changes nothing", () => {
  const rules = compile(allowlist);
  for (const fixture of ruleFixtures()) {
    const once = transformTraces(rules, fixture.request, {});
    const twice = transformTraces(rules, once, {});
    assert.deepEqual(twice, once, fixture.name);
  }
});

test("metrics and logs are dropped, and so is everything without a key or that is not a request", () => {
  const [fixture] = ruleFixtures();
  assert.equal(transform("metrics", fixture.request), null);
  assert.equal(transform("logs", fixture.request), null);
  assert.equal(createTransform(allowlist, undefined)("traces", fixture.request), null);
  assert.equal(createTransform(allowlist, "short")("traces", fixture.request), null);
  for (const nonsense of [null, 42, "text", [], {}, { resourceSpans: "x" }, { resourceSpans: [null, 3, { resource: 1 }] }]) {
    assert.equal(transform("traces", nonsense), null);
  }
});

test("the filter as the agent installs it reads its key from beside it, and sends nothing without one", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-filter-"));
  try {
    const [fixture] = ruleFixtures();
    fs.copyFileSync(new URL("../src/telemetry-transform.mjs", import.meta.url), path.join(directory, "without-key.mjs"));
    const { default: keyless } = await import(pathToFileURL(path.join(directory, "without-key.mjs")).href);
    assert.equal(keyless("traces", fixture.request), null);
    const keyed = path.join(directory, "keyed");
    fs.mkdirSync(keyed);
    fs.copyFileSync(new URL("../src/telemetry-transform.mjs", import.meta.url), path.join(keyed, "telemetry-transform.mjs"));
    fs.writeFileSync(path.join(keyed, "telemetry-transform.key"), `${testKey}\n`);
    const { default: installed } = await import(pathToFileURL(path.join(keyed, "telemetry-transform.mjs")).href);
    const kept = comparable([installed("traces", fixture.request)]);
    // As installed, it gives each span with a session its place there.
    assert.ok(kept.every((span) => !("session.id" in span.attributes) || Number.isInteger(span.attributes[offsetKey])));
    for (const span of kept) delete span.attributes[offsetKey];
    assert.deepEqual(kept, expectedSpans(fixture));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the IPv6 pattern masks the usual ways of writing an address, and the tools' own values pass", () => {
  const { blocked } = compile(allowlist);
  const ipv6 = blocked.find(({ what }) => what === "an IPv6 address").test;
  for (const address of ["::1", "fe80::1", "2001:db8::8a2e:370:7334", "2001:0db8:0000:0000:0000:ff00:0042:8329", "fe80::1%en0", "::ffff:10.0.0.1"]) {
    assert.ok(ipv6.test(`at ${address} today`), address);
  }
  for (const value of ["tools/call", "14.0.0", "2025-06-18", "claude-code", "side=class", "/packages/0"]) {
    assert.ok(blocked.every(({ test: pattern }) => !pattern.test(value)), value);
  }
});

test("an int is kept only as an int64, as the collector reads one, and a long value never makes a pattern backtrack", () => {
  const rules = compile(allowlist);
  const request = (value, tool = "class_get") => ({ resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "pharo-mcp" } }] }, scopeSpans: [{ scope: { name: "mcp-pharo" }, spans: [{
    traceId: "1700abababababababababababababab", spanId: "cccccccccccc0001", name: "tools/call", kind: 2, startTimeUnixNano: "1763630000000000000", endTimeUnixNano: "1763630000000000000",
    attributes: [{ key: "gen_ai.tool.name", value: { stringValue: tool } }, { key: "pharo.mcp.input.bytes", value: { intValue: value } }, { key: "session.id", value: { stringValue: "s" } }],
  }] }] }] });
  const bytes = (value) => transformTraces(rules, request(value), {}).resourceSpans[0].scopeSpans[0].spans[0].attributes.find(({ key }) => key === "pharo.mcp.input.bytes")?.value.intValue;
  assert.equal(bytes("9223372036854775807"), "16777216");
  assert.equal(bytes("9223372036854775808"), undefined);
  assert.equal(bytes(9007199254740993), undefined);
  const start = process.hrtime.bigint();
  transformTraces(rules, request("1", "a".repeat(1_000_000)), {});
  assert.ok(process.hrtime.bigint() - start < 2_000_000_000n, "a megabyte-long tool name took seconds");
});

/** One span of `service` in one request, as a tool sends it. */
const oneSpan = (service, { session, start = "1763630000000000000", spanId = "cccccccccccc0001", kind = 2 } = {}) => ({ resourceSpans: [{
  resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
  scopeSpans: [{ scope: { name: service === "plexus" ? "@evref-bl/plexus" : "mcp-pharo" }, spans: [{
    traceId: "1800abababababababababababababab", spanId, name: "tools/call class_get", kind, startTimeUnixNano: start, endTimeUnixNano: start,
    attributes: [{ key: "gen_ai.tool.name", value: { stringValue: "class_get" } }, ...(session ? [{ key: "session.id", value: { stringValue: session } }] : [])],
  }] }],
}] });
const attribute = (request, key) => request?.resourceSpans[0].scopeSpans[0].spans[0].attributes.find((each) => each.key === key)?.value;

test("the agent gives each span its place in its session, in milliseconds from the first it saw, and none without a session", () => {
  const installed = createTransform(allowlist, testKey);
  const offset = (request) => attribute(installed("traces", request), offsetKey)?.intValue;
  assert.equal(offset(oneSpan("pharo-mcp", { session: "a", start: "1763630000000000000" })), "0");
  assert.equal(offset(oneSpan("pharo-mcp", { session: "a", start: "1763630000250000000", spanId: "cccccccccccc0002" })), "250");
  assert.equal(offset(oneSpan("pharo-mcp", { session: "a", start: "1763629999000000000", spanId: "cccccccccccc0003" })), "-1000");
  assert.equal(offset(oneSpan("plexus", { session: "b", start: "1763630000250000000" })), "0");
  assert.equal(offset(oneSpan("plexus", { start: "1763630000250000000" })), undefined);
  // A place a tool made up is not the agent's: dropped without a session, replaced with one.
  const sent = oneSpan("plexus");
  sent.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({ key: offsetKey, value: { intValue: "42" } });
  assert.equal(offset(sent), undefined);
});

test("a session id and the ids of its spans hash within the session and the week: the same trace context links no two sessions", () => {
  const installed = createTransform(allowlist, testKey, { offsets: false });
  const ids = (request) => {
    const span = installed("traces", request).resourceSpans[0].scopeSpans[0].spans[0];
    return { trace: span.traceId, span: span.spanId, session: attribute({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }, "session.id")?.stringValue };
  };
  const first = ids(oneSpan("pharo-mcp", { session: "a" }));
  assert.deepEqual(ids(oneSpan("pharo-mcp", { session: "a" })), first);
  const otherSession = ids(oneSpan("pharo-mcp", { session: "b" }));
  const nextWeek = ids(oneSpan("pharo-mcp", { session: "a", start: "1764234800000000000" }));
  for (const other of [otherSession, nextWeek]) {
    assert.notEqual(other.trace, first.trace);
    assert.notEqual(other.span, first.span);
    assert.notEqual(other.session, first.session);
  }
});

test("MCP's spans are kept only when they serve a call in a session, PLexus's of every kind in a session", () => {
  const installed = createTransform(allowlist, testKey);
  assert.notEqual(installed("traces", oneSpan("pharo-mcp", { session: "a" })), null);
  assert.equal(installed("traces", oneSpan("pharo-mcp")), null);
  assert.equal(installed("traces", oneSpan("pharo-mcp", { session: "a", kind: 1 })), null);
  assert.equal(installed("traces", oneSpan("pharo-mcp", { session: "" })), null);
  assert.notEqual(installed("traces", oneSpan("plexus", { kind: 1, session: "a" })), null);
  // A PLexus span without a session would hash to another trace than its image's spans, which have one.
  assert.equal(installed("traces", oneSpan("plexus", { kind: 1 })), null);
});

test("offsets go on across the agent's restarts, and a new session among twenty thousand costs no scan", () => {
  const sessions = new Map();
  const first = createTransform(allowlist, testKey, { sessions });
  const span = (start) => oneSpan("pharo-mcp", { session: "a", start });
  const offset = (request) => request.resourceSpans[0].scopeSpans[0].spans[0].attributes.find(({ key }) => key === "pharo_agent_telemetry.session.offset_ms")?.value.intValue;
  assert.equal(offset(first("traces", span("1763630000000000000"))), "0");
  // Another run of the agent, given the sessions the first remembered.
  const second = createTransform(allowlist, testKey, { sessions });
  assert.equal(offset(second("traces", span("1763630000500000000"))), "500");
  let clock = 0;
  const memory = new Map();
  const place = sessionOffsets(() => clock, memory);
  const began = performance.now();
  for (let index = 0; index < 20_000; index += 1) {
    clock += 1;
    place(`s${index}`, BigInt(index));
  }
  assert.ok(performance.now() - began < 1_000, "20,000 sessions in under a second");
  assert.equal(memory.size, sessionMemory.sessions);
  assert.equal(memory.keys().next().value, `s${20_000 - sessionMemory.sessions}`);
  clock += sessionMemory.idle + 1;
  place("late", 0n);
  assert.deepEqual([...memory.keys()], ["late"]);
});
