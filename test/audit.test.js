import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { audit, blockedPattern } from "../src/audit.js";
import { readAllowlist } from "../src/generate.js";
import { ruleFixtures, testKey } from "./support.js";
import { filter } from "../src/telemetry-transform.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowlist = readAllowlist(root);

test("reads the allowlist's blocked patterns, inline flags included", () => {
  assert.ok(blockedPattern(allowlist.blockedValues["a home directory path"]).test("at /USERS/ada/x"));
  assert.ok(blockedPattern(allowlist.blockedValues["an email address"]).test("a\nada@example.org"));
  assert.equal(blockedPattern(allowlist.blockedValues["an IPv4 address"]).test("4.1.2"), false);
  assert.ok(blockedPattern(allowlist.blockedValues["an IPv6 address"]).test("from FE80::1"));
});

test("names everything a span carries that the rules would not keep as it is", () => {
  const fixture = fs.readFileSync(new URL("./fixtures/forbidden.json", import.meta.url), "utf8");
  const { problems } = audit([JSON.stringify(JSON.parse(fixture))], allowlist);
  for (const expected of [
    "resource: host.name is not in the allowlist",
    "resource: process.runtime.version holds a value the rules would change",
    "resource: a schema URL is kept",
    "a scope keeps attributes",
    "the scope's version is not a version",
    "span tools/call class_get: code.source is not in the allowlist",
    "span tools/call class_get: plexus.client.name holds a home directory path",
    "span tools/call class_get: error.type holds a value the rules would change",
    "span tools/call class_get: plexus.client.version holds an IPv4 address",
    "span tools/call image_list: plexus.client.name holds an IPv6 address",
    "span tools/call class_get: gen_ai.tool.name would be dropped",
    "span tools/call class_get: span.duration_ms is missing",
    "span tools/call class_get: events are kept",
    "span tools/call class_get: a trace state is kept",
    "span tools/call class_get: its times are not its week's",
    "span tools/call class_get: the name is not what the rules make of it",
    "span open /Users/ada/project/secret.st: is not an operation of ours",
    "span tools/call image_list: plexus.argument.unknown_names holds an element without its shape",
    "span tools/call acme_secret_tool: gen_ai.tool.name holds a value the rules would change",
    "span tools/call acme_secret_tool: pharo.mcp.argument.names would be dropped",
  ]) {
    assert.ok(problems.some((problem) => problem.includes(expected)), `${expected}\n${problems.join("\n")}`);
  }
});

test("says nothing of an archive that holds only what the rules keep, and counts the spans of each tool", () => {
  const transform = filter(testKey);
  const lines = ruleFixtures().map((fixture) => transform("traces", fixture.request)).filter(Boolean).map((request) => JSON.stringify(request));
  // The collector names each day's file by a resource attribute of its own.
  const archived = lines.map((line) => line.replace('"attributes":[', '"attributes":[{"key":"fileexporter.path_segment","value":{"stringValue":"2026-11-22"}},'));
  const { spans, keys, problems } = audit([...archived, ""], allowlist);
  assert.deepEqual(problems, []);
  assert.equal(spans.get("plexus tools/call"), 7);
  assert.ok(keys.has("span.duration_ms"));
  assert.ok(!keys.has("fileexporter.path_segment"));
});
