// What scripts/catalog.js reads in the projects' source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyCatalog } from "../src/agent.js";
import { catalogPayload, exceptionClasses, publicKeyOf, signCatalog, smalltalkLiterals, smalltalkToolNames, withCatalog, wordsOf } from "../src/catalog.js";
import { readAllowlist } from "../src/generate.js";
import { catalogProblem, withCatalogSets } from "../src/rules.js";
import { catalog as builtIn, catalogRefusal } from "../src/telemetry-transform.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const throwawayKey = () => /** @type {string} */ (generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));

test("a name's words are split on _, - and camelCase, in lower case, one-letter words kept", () => {
  assert.deepEqual(wordsOf("ClassNotFound"), ["class", "not", "found"]);
  assert.deepEqual(wordsOf("method_sourceAt-x"), ["method", "source", "at", "x"]);
  assert.deepEqual(wordsOf("HTTPServer"), ["http", "server"]);
  assert.deepEqual(wordsOf("NotATestClass"), ["not", "a", "test", "class"]);
  assert.deepEqual(wordsOf("2fa_code"), ["code"]);
});

test("the exception classes a project can name: those it refers to, its tests' strings included, and those it defines below one", () => {
  const code = `"A comment naming CommentOnlyError"
Class {
	#name : 'MCPInvalidToolInput',
	#superclass : 'JRPCInvalidParameters',
	#category : 'MCP'
}
Class {
	#name : 'MCPTool',
	#superclass : 'Object',
	#category : 'MCP'
}
MCPTool >> run [ ^ [ self compile ] on: OCUndeclaredVariableNotice do: [ :e | $" ] ]`;
  const test = "MCPToolTest >> testCompile [ self assert: (self typeOf: 'x') equals: 'OCSyntaxErrorNotice' ]";
  assert.deepEqual(exceptionClasses([code], [test]), ["MCPInvalidToolInput", "OCSyntaxErrorNotice", "OCUndeclaredVariableNotice"]);
});

test("the strings and unary symbols of Tonel code are read, comments and characters left out", () => {
  const text = `"a comment with 'quotes' and #words"
foo [ ^ #('it''s' #className $' 'two words' #at:put: #'source-code') ]`;
  assert.deepEqual(smalltalkLiterals(text), ["className", "source-code"]);
});

test("a tool class's name is the literal its class-side toolName answers", () => {
  const text = "MCPClassGetTool class >> toolName [\n\t^ 'class_get'\n]\n\nMCPOther >> toolName [ ^ 'not_a_tool' ]";
  assert.deepEqual(smalltalkToolNames(text), ["class_get"]);
});

test("the catalog's sets join the allowlist's, and a set in both is refused", () => {
  const allowlist = { sets: { "agent hosts": ["claude-code"] } };
  const merged = withCatalog(allowlist, { releases: { MCP: "v1" }, sets: { "MCP tools": ["class_get"] } });
  assert.deepEqual(merged.sets, { "agent hosts": ["claude-code"], "MCP tools": ["class_get"] });
  assert.deepEqual(merged.releases, { MCP: "v1" });
  assert.throws(() => withCatalog(allowlist, { releases: {}, sets: { "agent hosts": [] } }), /both in the allowlist and in the catalog/);
});

test("the catalog the project signs is every set of the allowlist and the catalog, which the filter takes; one changes names, and nothing else", () => {
  const allowlist = readAllowlist(root);
  const payload = catalogPayload(allowlist, "2030-01-01T00:00:00.000Z");
  assert.equal(payload.schema, 1);
  assert.deepEqual(payload.releases, builtIn.releases);
  assert.deepEqual(Object.keys(payload.sets).sort(), Object.keys(allowlist.sets).sort());
  assert.equal(catalogRefusal(payload), undefined);
  assert.equal(builtIn.published, JSON.parse(fs.readFileSync(path.join(root, "collector", "catalog.json"), "utf8")).published);
  assert.match(catalogRefusal({ ...payload, schema: 2 }), /of form 2, and this agent reads form 1/);
  assert.match(catalogRefusal({ ...payload, published: "soon" }), /has no date/);
  assert.match(catalogRefusal({ ...payload, sets: { "agent hosts": "claude-code" } }), /agent hosts is not a list/);
  // A member of a set is a name: never a path, an address, a word of another shape.
  for (const [set, member] of [["agent hosts", "/Users/ada/tool"], ["agent hosts", "ada@example.org"], ["MCP tools", "10.0.0.1"], ["project words", "Secret"], ["project words", "two words"], ["MCP tools", "x".repeat(65)]]) {
    assert.match(catalogRefusal({ ...payload, sets: { [set]: [member] } }), new RegExp(`its ${set} holds a member of another shape`), member);
  }
  // A set the rules do not have gates nothing: left out, so a catalog can only change the members of the sets the rules already use.
  const widened = { ...payload, sets: { "MCP tools": ["class_get"], "secrets": ["anything"] } };
  assert.equal(catalogProblem(allowlist, widened), undefined);
  const applied = withCatalogSets(allowlist, widened);
  assert.equal("secrets" in applied.sets, false);
  assert.deepEqual(applied.sets["MCP tools"], ["class_get"]);
  assert.deepEqual(Object.keys(applied).sort(), Object.keys(allowlist).sort());
  for (const key of ["services", "resource", "span", "patterns", "blockedValues", "vocabulary", "published"]) assert.deepEqual(applied[key], allowlist[key], key);
});

test("a signed catalog holds only by the key that signed it, and only as signed", () => {
  const key = throwawayKey();
  const payload = catalogPayload(readAllowlist(root), "2030-01-01T00:00:00.000Z");
  const signed = signCatalog(payload, key);
  assert.deepEqual(verifyCatalog(signed, publicKeyOf(key)), { payload });
  assert.deepEqual(verifyCatalog(signed, publicKeyOf(throwawayKey())), { refused: "its signature does not hold" });
  const envelope = JSON.parse(signed);
  const tampered = JSON.stringify({ ...envelope, payload: envelope.payload.replace('"class_get"', '"class_got"') });
  assert.deepEqual(verifyCatalog(tampered, publicKeyOf(key)), { refused: "its signature does not hold" });
  assert.deepEqual(verifyCatalog("not json", publicKeyOf(key)), { refused: "it is not JSON" });
  assert.deepEqual(verifyCatalog(JSON.stringify(payload), publicKeyOf(key)), { refused: "it is not a signed catalog" });
  assert.deepEqual(verifyCatalog(signed, "not a key"), { refused: "its signature does not hold" });
});

test("npm run sign-catalog makes a key outside the repository only, never replaces one, and signs the catalog with it", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-sign-"));
  const script = path.join(root, "scripts", "sign-catalog.js");
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  try {
    const key = path.join(directory, "keys", "catalog.pem");
    const made = run("--new-key", key);
    assert.equal(made.status, 0, made.stderr);
    assert.equal(fs.statSync(key).mode & 0o777, 0o600);
    const publicKey = made.stdout.trim().split("\n").at(-1);
    assert.equal(publicKey, publicKeyOf(fs.readFileSync(key, "utf8")));
    assert.match(run("--new-key", key).stderr, /a key is never replaced/);
    const inside = path.join(root, "collector", "catalog.pem");
    assert.match(run("--new-key", inside).stderr, /is in this repository: keep the private key outside it/);
    assert.equal(fs.existsSync(inside), false);
    const out = path.join(directory, "published", "catalog.json");
    const signed = run("--key", key, "--out", out, "--published", "2030-01-01T00:00:00.000Z");
    assert.equal(signed.status, 0, signed.stderr);
    const verified = verifyCatalog(fs.readFileSync(out, "utf8"), publicKey);
    assert.ok("payload" in verified, JSON.stringify(verified));
    assert.deepEqual(verified.payload, catalogPayload(readAllowlist(root), "2030-01-01T00:00:00.000Z"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
