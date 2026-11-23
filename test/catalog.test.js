// What scripts/catalog.js reads in the projects' source.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyCatalog, weakPublicKey } from "../src/agent.js";
import { catalogPayload, ciPharoVersions, exceptionNames, pharoTemplate, publicKeyOf, signCatalog, smalltalkLiterals, smalltalkToolNames, withCatalog, wordsOf } from "../src/catalog.js";
import { catalogAdditionCap, catalogAdditions, catalogLeftOut, withCatalogSets } from "../src/rules.js";
import { missingForJoin, readAllowlist, studyPath } from "../src/study.js";
import { study, transformModule } from "./support.js";

const { catalog: builtIn, catalogAdded, catalogRefusal } = transformModule;
const root = fileURLToPath(new URL("..", import.meta.url));
const readyCollector = { endpoint: "https://c.test", token: "t", controller: { name: "n", contact: "c" }, dpo: "d", host: { provider: "p", region: "r", importer: "i", archive: "a" }, catalogUrl: "https://c.test/pharo-agent-telemetry/catalog.json" };
const throwawayKey = () => /** @type {string} */ (generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));

test("a name's words are split on _, - and camelCase, in lower case, one-letter words kept", () => {
  assert.deepEqual(wordsOf("ClassNotFound"), ["class", "not", "found"]);
  assert.deepEqual(wordsOf("method_sourceAt-x"), ["method", "source", "at", "x"]);
  assert.deepEqual(wordsOf("HTTPServer"), ["http", "server"]);
  assert.deepEqual(wordsOf("NotATestClass"), ["not", "a", "test", "class"]);
  assert.deepEqual(wordsOf("2fa_code"), ["code"]);
});

test("the Pharo versions a CI runs are the smalltalkCI images its workflow names", () => {
  assert.deepEqual(ciPharoVersions("matrix:\n  smalltalk: [ Pharo64-12, Pharo64-10, Pharo64-15 ]\n# Pharo64-12 again, and Squeak64-6.0\n"), [10, 12, 15]);
  assert.deepEqual(ciPharoVersions("smalltalk: [ Squeak64-6.0 ]"), []);
});

test("an image of a Pharo version is made from its 64-bit template, the stable one and a distribution's first, or from none", () => {
  const templates = [
    { name: "Pharo 10.0 - 64bit", category: "Pharo Courses" },
    { name: "Pharo 14.0 - 64bit (next stable)", category: "Official distributions" },
    { name: "Pharo 14.0 - 64bit (stable)", category: "Official distributions" },
    { name: "Pharo 10.0 - 64bit", category: "Deprecated distributions" },
    { name: "Pharo 10.0 - 32bit", category: "Deprecated distributions" },
    { name: "Moose Suite 13 (stable)", category: "Official distributions" },
    { name: "Pharo 140.0 - 64bit", category: "Official distributions" },
  ];
  assert.deepEqual(pharoTemplate(14, templates), { name: "Pharo 14.0 - 64bit (stable)", category: "Official distributions" });
  assert.deepEqual(pharoTemplate(10, templates), { name: "Pharo 10.0 - 64bit", category: "Deprecated distributions" });
  assert.equal(pharoTemplate(13, templates), undefined);
  assert.equal(pharoTemplate(1, templates), undefined);
});

test("the exception names an image wrote are its lines but those that start with #, which say what named them", () => {
  assert.deepEqual(exceptionNames("# MCP 4.3.0 in Pharo-14.0.0+build.1 (64 Bit)\nAbort\r\nZeroDivide\n\n"), { from: ["MCP 4.3.0 in Pharo-14.0.0+build.1 (64 Bit)"], names: ["Abort", "ZeroDivide"] });
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

test("the catalog a study signs is the sets that grow with releases, which the filter reads; only a date of one strict form is one", () => {
  const allowlist = readAllowlist(study);
  const payload = catalogPayload(allowlist, "2030-01-01T00:00:00.000Z");
  assert.equal(payload.schema, 1);
  assert.deepEqual(payload.releases, builtIn.releases);
  assert.deepEqual(Object.keys(payload.sets).sort(), Object.keys(allowlist.grows).sort());
  for (const name of Object.keys(allowlist.grows)) assert.deepEqual(payload.sets[name], allowlist.sets[name], name);
  assert.equal(catalogRefusal(payload), undefined);
  assert.deepEqual(catalogLeftOut(allowlist, payload), []);
  // Each set, whole, is no more than a catalog adds: an agent of any earlier package takes all of it.
  for (const name of Object.keys(allowlist.grows)) assert.ok(payload.sets[name].length <= catalogAdditionCap, name);
  assert.equal(builtIn.published, JSON.parse(fs.readFileSync(studyPath(study, "catalog"), "utf8")).published);
  assert.match(catalogRefusal({ ...payload, schema: 2 }), /of form 2, and this agent reads form 1/);
  assert.match(catalogRefusal({ ...payload, sets: [] }), /has no sets/);
  for (const published of ["+275760-09-13T00:00:00.000Z", "2027", "Nov 23 2026", "2026-02-30T00:00:00Z", "2026-11-23T10:00:00+01:00", "2026-11-23 10:00:00Z", "2026-11-23T10:00:00.1Z", undefined]) {
    assert.match(String(catalogRefusal({ ...payload, published })), /its date is not a UTC date/, String(published));
  }
  for (const published of ["2026-11-23T10:00:00Z", "2026-11-23T10:00:00.123Z"]) assert.equal(catalogRefusal({ ...payload, published }), undefined, published);
});

test("a catalog only adds, and only to the sets that grow, members of their strict shape, each left out on its own, at most 2,000 a set", () => {
  const allowlist = readAllowlist(study);
  const catalog = {
    schema: 1,
    published: "2030-01-01T00:00:00Z",
    sets: {
      "MCP tools": ["class_get", "new_tool", "Bad-Tool", "/Users/ada", 7],
      "project words": ["zzqx", "Secret", "x".repeat(25), "ok2", "two words"],
      "Node exception classes": ["AcmeError", "not_a_class", "Error"],
      "MCP exception classes": ["LGit_GIT_EZQX", "Ice-CloneError", "Ice.CloneError", "_Leading"],
      "PLexus error codes": ["new-code", "NewCode", "a--b"],
      "agent hosts": ["evil-host"],
      "OS types": ["plan9"],
      "call failures": ["sneaky"],
      "secrets": ["anything"],
    },
  };
  assert.deepEqual(catalogAdditions(allowlist, catalog), { "MCP tools": ["new_tool"], "project words": ["zzqx", "ok2"], "Node exception classes": ["AcmeError"], "MCP exception classes": ["LGit_GIT_EZQX"], "PLexus error codes": ["new-code"] });
  assert.deepEqual(catalogAdded(catalog), catalogAdditions(allowlist, catalog));
  const applied = withCatalogSets(allowlist, catalog);
  // Nothing removed: the package's members stay, the added ones follow.
  assert.deepEqual(applied.sets["MCP tools"], [...allowlist.sets["MCP tools"], "new_tool"]);
  for (const name of ["agent hosts", "OS types", "call failures", "schema keywords", "guessed words"]) assert.deepEqual(applied.sets[name], allowlist.sets[name], name);
  assert.equal("secrets" in applied.sets, false);
  for (const key of ["services", "resource", "span", "patterns", "blockedValues", "vocabulary", "published", "grows"]) assert.deepEqual(applied[key], allowlist[key], key);
  const leftOut = catalogLeftOut(allowlist, catalog);
  for (const each of ['MCP tools: "Bad-Tool"', 'MCP tools: "/Users/ada"', 'project words: "Secret"', 'PLexus error codes: "NewCode"', 'MCP exception classes: "Ice-CloneError"', 'MCP exception classes: "Ice.CloneError"', 'MCP exception classes: "_Leading"', "agent hosts (a set no catalog adds to)", "secrets (a set no catalog adds to)"]) assert.ok(leftOut.includes(each), each);
  // A catalog adds at most catalogAdditionCap members to a set.
  const many = Array.from({ length: catalogAdditionCap + 500 }, (_, index) => `zq${index.toString(36)}`);
  assert.equal(catalogAdditions(allowlist, { ...catalog, sets: { "project words": many } })["project words"].length, catalogAdditionCap);
  assert.equal(catalogAdditionCap, 2_000);
});

test("a signed catalog holds only by the key that signed it, and only as signed", () => {
  const key = throwawayKey();
  const payload = catalogPayload(readAllowlist(study), "2030-01-01T00:00:00.000Z");
  const signed = signCatalog(payload, key);
  assert.deepEqual(verifyCatalog(signed, publicKeyOf(key)), { payload });
  assert.deepEqual(verifyCatalog(signed, publicKeyOf(throwawayKey())), { refused: "its signature does not hold" });
  const envelope = JSON.parse(signed);
  const tampered = JSON.stringify({ ...envelope, payload: envelope.payload.replace('"class_get"', '"class_got"') });
  assert.deepEqual(verifyCatalog(tampered, publicKeyOf(key)), { refused: "its signature does not hold" });
  assert.deepEqual(verifyCatalog("not json", publicKeyOf(key)), { refused: "it is not JSON" });
  assert.deepEqual(verifyCatalog(JSON.stringify(payload), publicKeyOf(key)), { refused: "it is not a signed catalog" });
  assert.deepEqual(verifyCatalog(signed, "not a key"), { refused: "the public key is one anyone can sign for" });
});

test("a public key anyone can sign for is no key: a small-order point, the identity, or not 32 bytes", () => {
  const forged = (point) => JSON.stringify({ payload: JSON.stringify(catalogPayload(readAllowlist(study), "2030-01-01T00:00:00Z")), signature: Buffer.concat([Buffer.from(point, "hex"), Buffer.alloc(32)]).toString("base64") });
  const weak = ["0100000000000000000000000000000000000000000000000000000000000000", "0000000000000000000000000000000000000000000000000000000000000000", "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a"];
  for (const hex of weak) {
    const key = Buffer.from(hex, "hex").toString("base64url");
    assert.equal(weakPublicKey(key), true, hex);
    assert.deepEqual(verifyCatalog(forged("0100000000000000000000000000000000000000000000000000000000000000"), key), { refused: "the public key is one anyone can sign for" });
    assert.deepEqual(missingForJoin({ ...readyCollector, catalogPublicKey: key }), ["catalogPublicKey"]);
  }
  for (const key of ["", "short", Buffer.alloc(31).toString("base64url"), `${publicKeyOf(throwawayKey())}=`]) assert.equal(weakPublicKey(key), true, key);
  const good = publicKeyOf(throwawayKey());
  assert.equal(weakPublicKey(good), false);
  assert.deepEqual(missingForJoin({ ...readyCollector, catalogPublicKey: good }), []);
});

test("sign-catalog makes a key outside the study only, never replaces one, and signs the catalog with it", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-sign-"));
  const script = path.join(root, "scripts", "sign-catalog.js");
  const run = (...args) => spawnSync(process.execPath, [script, "--study", study.directory, ...args], { encoding: "utf8" });
  try {
    const key = path.join(directory, "keys", "catalog.pem");
    const made = run("--new-key", key);
    assert.equal(made.status, 0, made.stderr);
    assert.equal(fs.statSync(key).mode & 0o777, 0o600);
    const publicKey = made.stdout.trim().split("\n").at(-1);
    assert.equal(publicKey, publicKeyOf(fs.readFileSync(key, "utf8")));
    assert.match(run("--new-key", key).stderr, /a key is never replaced/);
    const inside = path.join(study.directory, "collector", "catalog.pem");
    assert.match(run("--new-key", inside).stderr, /is in the study's directory: keep the private key outside it/);
    assert.equal(fs.existsSync(inside), false);
    const out = path.join(directory, "published", "catalog.json");
    // A date ahead of now, or of another form, is never signed.
    assert.match(run("--key", key, "--out", out, "--published", "2099-01-01T00:00:00.000Z").stderr, /is in the future/);
    assert.match(run("--key", key, "--out", out, "--published", "Nov 23 2026").stderr, /is not a UTC date/);
    assert.equal(fs.existsSync(out), false);
    const signed = run("--key", key, "--out", out, "--published", "2026-11-01T00:00:00.000Z");
    assert.equal(signed.status, 0, signed.stderr);
    const verified = verifyCatalog(fs.readFileSync(out, "utf8"), publicKey);
    assert.ok("payload" in verified, JSON.stringify(verified));
    assert.deepEqual(verified.payload, catalogPayload(readAllowlist(study), "2026-11-01T00:00:00.000Z"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
