// A study as data: what readStudy takes and refuses, what init starts, and
// what the commands do when no study, or another one, is named.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readStudy } from "../src/study.js";
import { study } from "./support.js";

const binary = new URL("../bin/pharo-agent-telemetry.js", import.meta.url).pathname;

function scratch(run) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pat-study-")));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** A copy of the example study, changed by `change`, in a directory of its own. */
function copyOf(directory, change = (each) => each) {
  const copy = path.join(directory, "study");
  fs.cpSync(study.directory, copy, { recursive: true });
  const file = path.join(copy, "study.json");
  fs.writeFileSync(file, JSON.stringify(change(JSON.parse(fs.readFileSync(file, "utf8")))));
  return copy;
}

test("a study needs an id, the page's texts, and only collector facts; null is not set yet", () => scratch((directory) => {
  assert.throws(() => readStudy(directory), /is not a study: it needs a package\.json and a study\.json/);
  assert.throws(() => readStudy(copyOf(directory, (each) => ({ ...each, id: "Not One" }))), /needs an id of lowercase letters/);
  fs.rmSync(path.join(directory, "study"), { recursive: true });
  assert.throws(() => readStudy(copyOf(directory, (each) => ({ ...each, text: { ...each.text, why: " " } }))), /needs text\.why/);
  fs.rmSync(path.join(directory, "study"), { recursive: true });
  assert.throws(() => readStudy(copyOf(directory, (each) => ({ ...each, text: { ...each.text, authority: " " } }))), /text\.authority, when set, is text/);
  fs.rmSync(path.join(directory, "study"), { recursive: true });
  assert.throws(() => readStudy(copyOf(directory, (each) => ({ ...each, collector: { ...each.collector, password: "x" } }))), /collector\.password is no collector fact/);
  assert.deepEqual(study.collector, {});
  assert.equal(study.name, "@example/pharo-agent-study");
}));

test("without a study, join and preview say how to name one, and status and leave act on whatever agent this home has", () => scratch((home) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, "config"), APPDATA: "", PHARO_AGENT_TELEMETRY_DRY_RUN: path.join(home, "commands.jsonl") };
  const run = (...args) => spawnSync(process.execPath, [binary, ...args], { env, encoding: "utf8" });
  for (const command of ["join", "preview"]) assert.match(run(command).stderr, /Name the study: run its package \(npx <its package> <command>\), or give --study <its directory>\./, command);
  assert.match(run("status").stdout, /^Not joined\./);
  assert.equal(run("leave").status, 0);
  assert.match(run().stdout, /A study's operators, in the study's directory or with --study:/);
}));

test("a home joins one study at a time: another study's join refuses until leave", () => scratch((home) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, "config"), APPDATA: "", PHARO_AGENT_TELEMETRY_DRY_RUN: path.join(home, "commands.jsonl") };
  const other = copyOf(home, (each) => ({ ...each, id: "other" }));
  const run = (directory, ...args) => spawnSync(process.execPath, [binary, "--study", directory, ...args], { env, encoding: "utf8" });
  assert.equal(run(study.directory, "join", "--endpoint", "https://c.test").status, 0);
  const refused = run(other, "join", "--endpoint", "https://c.test");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /You joined the study example \(.*\): run leave first, then join this one\./);
  // The same study joins again; another study's leave leaves any.
  assert.equal(run(study.directory, "join", "--endpoint", "https://c.test").status, 0);
  assert.equal(run(other, "leave").status, 0);
  assert.equal(run(other, "join", "--endpoint", "https://c.test").status, 0);
  assert.match(run(other, "status").stdout, /, of the study other on 127\.0\.0\.1:/);
  assert.equal(run(other, "leave").status, 0);
}));

test("init starts a study from the example, which generates and then checks as current; a stale file is found", () => scratch((directory) => {
  const target = path.join(directory, "mine");
  const started = spawnSync(process.execPath, [binary, "init", target], { encoding: "utf8" });
  assert.equal(started.status, 0, started.stderr);
  const own = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")).dependencies[own.name], own.version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "study.json"), "utf8")).id, "mine");
  assert.match(spawnSync(process.execPath, [binary, "init", target], { encoding: "utf8" }).stderr, /is not empty/);
  const generate = (...args) => spawnSync(process.execPath, [binary, "generate", "--study", target, ...args], { encoding: "utf8" });
  assert.equal(generate().status, 0);
  assert.equal(generate("--check").status, 0);
  assert.equal(fs.statSync(path.join(target, "collector", "start.sh")).mode & 0o111, 0o111);
  fs.appendFileSync(path.join(target, "docs", "participants.md"), "edited\n");
  const stale = generate("--check");
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /docs\/participants\.md is out of date/);
}));

test("a study that ships another filter than its data makes is refused before anything is installed", () => scratch((home) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, "config"), APPDATA: "", PHARO_AGENT_TELEMETRY_DRY_RUN: path.join(home, "commands.jsonl") };
  const edited = copyOf(home);
  fs.appendFileSync(path.join(edited, "telemetry-transform.mjs"), "export const kept = 'everything';\n");
  for (const command of ["join", "preview"]) {
    const refused = spawnSync(process.execPath, [binary, "--study", edited, command, "--endpoint", "https://c.test"], { env, encoding: "utf8" });
    assert.equal(refused.status, 1, command);
    assert.match(refused.stderr, /ships a filter that is not the one its allowlist and catalog make with pharo-agent-telemetry .*: nothing is installed/, command);
  }
  assert.equal(fs.existsSync(path.join(home, "config", "pharo-agent-telemetry")), false);
}));

test("a study is released only with its own name and one exact release of this package", async () => {
  const { releaseProblems } = await import("../scripts/check-release.js");
  const named = (id, name, pin) => releaseProblems("", [], { id, name, dependencies: { "@evref-bl/pharo-agent-telemetry": pin } });
  assert.deepEqual(named("mine", "@me/mine", "0.1.0"), []);
  assert.match(named("example", "@me/mine", "0.1.0").join(), /still named as the example/);
  assert.match(named("mine", "@example/pharo-agent-study", "0.1.0").join(), /still named as the example/);
  for (const pin of ["^0.1.0", "~0.1.0", "*", "latest", undefined]) assert.match(named("mine", "@me/mine", pin).join(), /one exact release/, String(pin));
});

test("an allowlist names only the Pharo tools' services, and its bounds and buckets are numbers", async () => {
  const { compile } = await import("../src/rules.js");
  const { allowlist } = await import("./support.js");
  assert.throws(() => compile({ ...allowlist, services: { other: allowlist.services.plexus } }), /services are plexus or pharo-mcp, not other/);
  assert.throws(() => compile({ ...allowlist, services: {} }), /not none/);
  const withSpec = (spec) => ({ ...allowlist, span: { ...allowlist.span, "x.y": { type: "int", ...spec } } });
  assert.throws(() => compile(withSpec({ buckets: ['attributes["session.id"]'] })), /buckets are not whole numbers/);
  assert.throws(() => compile(withSpec({ buckets: [2, 1] })), /buckets are not whole numbers/);
  assert.throws(() => compile(withSpec({ min: "0" })), /min is not a number/);
  assert.doesNotThrow(() => compile(withSpec({ buckets: [0, 1, 2], min: 0 })));
});

test("a study's name, version, page and texts are refused when they could write a setting, a script or hide the page's text", () => scratch((directory) => {
  const withPackage = (change) => {
    const copy = copyOf(directory);
    const file = path.join(copy, "package.json");
    fs.writeFileSync(file, JSON.stringify(change(JSON.parse(fs.readFileSync(file, "utf8")))));
    return copy;
  };
  const fresh = (make) => {
    fs.rmSync(path.join(directory, "study"), { recursive: true, force: true });
    return make();
  };
  assert.throws(() => readStudy(fresh(() => withPackage((each) => ({ ...each, name: "@acme/evil\nOTEL_EXPORTER_OTLP_ENDPOINT=http://evil.example:1" })))), /needs a name npm takes/);
  assert.throws(() => readStudy(fresh(() => withPackage((each) => ({ ...each, name: "Evil Name" })))), /needs a name npm takes/);
  assert.throws(() => readStudy(fresh(() => withPackage((each) => ({ ...each, version: '1"; process.exit(); "' })))), /needs a version/);
  assert.throws(() => readStudy(fresh(() => copyOf(directory, (each) => ({ ...each, page: "javascript:alert(1)" })))), /page is an https:\/\/ URL/);
  for (const text of ["<!-- hidden", "<script>x</script>", "```\nfenced", "~~~"]) {
    assert.throws(() => readStudy(fresh(() => copyOf(directory, (each) => ({ ...each, text: { ...each.text, purpose: text } })))), /holds <, > or a code fence/, text);
  }
  assert.throws(() => readStudy(fresh(() => copyOf(directory, (each) => ({ ...each, collector: { ...each.collector, controller: { name: "A\nB", contact: "c" } } })))), /collector\.controller\.name is text on one line/);
  assert.throws(() => readStudy(fresh(() => copyOf(directory, (each) => ({ ...each, collector: { ...each.collector, dpo: "<img src=x onerror=alert(1)>" } })))), /holds <, >/);
  assert.throws(() => readStudy(fresh(() => copyOf(directory, (each) => ({ ...each, text: { ...each.text, publication: "<!-- hidden" } })))), /text\.publication holds <, >/);
  assert.throws(() => readStudy(fresh(() => copyOf(directory, (each) => ({ ...each, text: { ...each.text, publication: " " } })))), /text\.publication, when set, is text/);
}));

test("--endpoint is a collector's base URL, without credentials; the study's own is HTTPS", async () => {
  const { endpointProblem, missingForJoin } = await import("../src/study.js");
  for (const good of ["https://c.test", "https://c.test/base/", "http://127.0.0.1:4318"]) assert.equal(endpointProblem(good), undefined, good);
  assert.match(String(endpointProblem("not-a-url")), /is not a URL/);
  assert.match(String(endpointProblem("ftp://c.test")), /is not an http or https URL/);
  assert.match(String(endpointProblem("file:///etc/passwd")), /is not an http or https URL/);
  assert.match(String(endpointProblem("https://user:pw@c.test")), /holds credentials/);
  assert.match(String(endpointProblem("https://c.test/v1/traces")), /names \/v1\/traces/);
  const ready = { endpoint: "https://c.test", token: "t", controller: { name: "n", contact: "c" }, dpo: "d", host: { provider: "p", region: "r", importer: "i", archive: "a" }, catalogUrl: "https://c.test/pharo-agent-telemetry/catalog.json", catalogPublicKey: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
  assert.deepEqual(missingForJoin({ ...ready, endpoint: "http://c.test", catalogUrl: "http://c.test/pharo-agent-telemetry/catalog.json" }), ["endpoint"]);
});
