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
import { compile, createTransform, transformTraces } from "../src/rules.js";
import { readAllowlist } from "../src/generate.js";
import { comparable, expectedSpans, ruleFixtures, testKey } from "./support.js";

const root = new URL("..", import.meta.url).pathname;
const allowlist = readAllowlist(root);
const transform = filter(testKey);

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
    assert.deepEqual(comparable([installed("traces", fixture.request)]), expectedSpans(fixture));
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
    traceId: "1700abababababababababababababab", spanId: "cccccccccccc0001", name: "tools/call", startTimeUnixNano: "1763630000000000000", endTimeUnixNano: "1763630000000000000",
    attributes: [{ key: "gen_ai.tool.name", value: { stringValue: tool } }, { key: "pharo.mcp.input.bytes", value: { intValue: value } }],
  }] }] }] });
  const bytes = (value) => transformTraces(rules, request(value), {}).resourceSpans[0].scopeSpans[0].spans[0].attributes.find(({ key }) => key === "pharo.mcp.input.bytes")?.value.intValue;
  assert.equal(bytes("9223372036854775807"), "9223372036854775807");
  assert.equal(bytes("9223372036854775808"), undefined);
  assert.equal(bytes(9007199254740993), undefined);
  const start = process.hrtime.bigint();
  transformTraces(rules, request("1", "a".repeat(1_000_000)), {});
  assert.ok(process.hrtime.bigint() - start < 2_000_000_000n, "a megabyte-long tool name took seconds");
});
