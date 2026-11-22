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
    "span tools/call class_get: plexus.client.name holds a value the rules would change",
    "span tools/call class_get: error.type holds a value the rules would change",
    "span tools/call class_get: plexus.client.version holds an IPv4 address",
    "span tools/call image_list: plexus.client.name holds a value the rules would change",
    "span tools/call class_get: plexus.argument.names would be dropped",
    "span tools/call class_get: span.duration_ms is missing",
    "span tools/call class_get: events are kept",
    "span tools/call class_get: a trace state is kept",
    "span tools/call class_get: its times are not its week's",
    "span tools/call acme_secret_tool: the name is not what the rules make of it",
    "span open /Users/ada/project/secret.st: is not an operation of ours",
    "span tools/call image_list: plexus.argument.unknown_names holds an element without its shape",
    "span tools/call acme_secret_tool: gen_ai.tool.name holds a value the rules would change",
    "span tools/call acme_secret_tool: pharo.mcp.argument.names holds a word the vocabulary does not have",
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
  const plexusCalls = ruleFixtures().flatMap((fixture) => fixture.expected)
    .filter((span) => span.resource["service.name"] === "plexus" && span.name === "tools/call image_list").length;
  assert.ok(plexusCalls > 0);
  assert.equal(spans.get("plexus tools/call image_list"), plexusCalls);
  assert.ok(keys.has("span.duration_ms"));
  assert.ok(!keys.has("fileexporter.path_segment"));
});

test("two spans of a line that share an id are each set beside what the rules make of it", () => {
  const transform = filter(testKey);
  const fixture = ruleFixtures().find(({ name }) => name === "vocabulary");
  const kept = transform("traces", fixture.request);
  const [scopeSpans] = kept.resourceSpans[0].scopeSpans;
  const [first, second] = scopeSpans.spans.filter((span) => span.name !== scopeSpans.spans[0].name || span === scopeSpans.spans[0]);
  assert.notEqual(first.name, second.name);
  scopeSpans.spans = [first, { ...second, spanId: first.spanId }];
  assert.deepEqual(audit([JSON.stringify(kept)], allowlist).problems, []);
});

test("npm run audit takes a directory for the archive files in it", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-audit-"));
  try {
    const transform = filter(testKey);
    const kept = transform("traces", ruleFixtures().find(({ name }) => name === "vocabulary").request);
    fs.writeFileSync(path.join(directory, "traces-2026-11-22.jsonl"), `${JSON.stringify(kept)}\n`);
    fs.writeFileSync(path.join(directory, "notes.txt"), "not an archive");
    const script = fileURLToPath(new URL("../scripts/audit-archive.js", import.meta.url));
    const audited = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });
    assert.equal(audited.status, 0, audited.stderr);
    assert.match(audited.stdout, /Nothing the allowlist does not allow\./);
    assert.match(audited.stdout, /pharo-mcp tools\/call tests_run/);
    const missing = spawnSync(process.execPath, [script, path.join(directory, "gone")], { encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /no such file or directory/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
