import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { audit, blockedPattern } from "../src/audit.js";
import { readAllowlist } from "../src/generate.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowlist = readAllowlist(root);

test("reads the allowlist's blocked patterns, inline flags included", () => {
  assert.ok(blockedPattern(allowlist.blockedValues["a home directory path"]).test("at /USERS/ada/x"));
  assert.ok(blockedPattern(allowlist.blockedValues["an email address"]).test("a\nada@example.org"));
  assert.equal(blockedPattern(allowlist.blockedValues["an IPv4 address"]).test("4.1.2"), false);
});

test("names everything a span carries that the collector should have dropped", () => {
  const fixture = fs.readFileSync(new URL("./fixtures/forbidden.json", import.meta.url), "utf8");
  const { problems } = audit([JSON.stringify(JSON.parse(fixture))], allowlist);
  for (const expected of [
    "resource: host.name is not in the allowlist",
    "a scope keeps attributes",
    "span tools/call class_get: code.source is not in the allowlist",
    "span tools/call class_get: plexus.client.name holds a home directory path",
    "span tools/call class_get: error.type holds an email address",
    "span tools/call class_get: plexus.client.version holds an IPv4 address",
    "span tools/call class_get: events are kept",
    "span tools/call class_get: a trace state is kept",
    "the name is not an operation",
  ]) {
    assert.ok(problems.some((problem) => problem.includes(expected)), `${expected}\n${problems.join("\n")}`);
  }
});

test("counts the spans of each tool, and says nothing of an archive that holds only what is allowed", () => {
  const span = (name, attributes) => ({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", name, kind: 2, attributes });
  const line = JSON.stringify({ resourceSpans: [{
    resource: { attributes: [{ key: "service.name", value: { stringValue: "plexus" } }] },
    scopeSpans: [{ scope: { name: "@evref-bl/plexus" }, spans: [
      span("tools/call image_list", [{ key: "plexus.argument.names", value: { arrayValue: { values: [{ stringValue: "name" }] } } }]),
      span("plexus.image.create", [{ key: "plexus.image.from_base", value: { boolValue: true } }]),
    ] }],
  }] });
  const { spans, keys, problems } = audit([line, ""], allowlist);
  assert.deepEqual(problems, []);
  assert.deepEqual([...spans], [["plexus tools/call image_list", 1], ["plexus plexus.image.create", 1]]);
  assert.deepEqual([...keys].sort(), ["plexus.argument.names", "plexus.image.from_base", "service.name"]);
});
