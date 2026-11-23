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
  assert.throws(() => readStudy(copyOf(directory, (each) => ({ ...each, text: { ...each.text, authority: " " } }))), /needs text\.authority/);
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
  assert.match(refused.stderr, /You joined the study example: run its leave first, then join this one\./);
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
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")).dependencies[own.name], `^${own.version}`);
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
