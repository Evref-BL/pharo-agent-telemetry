// The agent's files and the tools' settings files, in a directory of the
// test's own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentPorts, agentStatus, filterVersion, freePort, installAgent, keyFile, packagedFiles, readAgentConfig, readKey, removeAgent } from "../src/install.js";
import { studyCommand } from "../src/study.js";
import { study } from "./support.js";

const command = studyCommand(study);
import { agentSettings, readSettings, removeSettings, settingsBlock, writeSettings } from "../src/settings.js";

function withDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-install-"));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const mode = (file) => fs.statSync(file).mode & 0o777;

test("the agent's directory holds its code, its settings and its key, only its owner reading the last two", () => withDirectory((parent) => {
  const directory = path.join(parent, "agent");
  installAgent(directory, { port: 4321, endpoint: "https://c.test", token: "t" }, packagedFiles(study));
  assert.equal(mode(directory), 0o700);
  assert.equal(mode(path.join(directory, "agent.mjs")), 0o644);
  assert.equal(mode(path.join(directory, "agent.json")), 0o600);
  assert.equal(mode(path.join(directory, keyFile)), 0o600);
  assert.deepEqual(readAgentConfig(directory), { port: 4321, endpoint: "https://c.test", token: "t" });
  const key = readKey(directory);
  assert.match(key, /^[0-9a-f]{64}$/);
  const status = agentStatus(directory, packagedFiles(study));
  assert.equal(status.present, true);
  assert.equal(status.current, true);
  assert.equal(status.key, true);
  assert.equal(status.version, study.version);

  // A valid key stays across installs; one that is not is replaced.
  installAgent(directory, { port: 4321, endpoint: "https://c.test" }, packagedFiles(study));
  assert.equal(readKey(directory), key);
  fs.writeFileSync(path.join(directory, keyFile), "not a key\n");
  assert.equal(readKey(directory), undefined);
  installAgent(directory, { port: 4321, endpoint: "https://c.test" }, packagedFiles(study));
  assert.notEqual(readKey(directory), undefined);
  assert.notEqual(readKey(directory), key);

  fs.writeFileSync(path.join(directory, "agent.json"), '{"port":"4321"}');
  assert.equal(readAgentConfig(directory), undefined);

  fs.writeFileSync(path.join(directory, "sessions.json"), "[]");
  assert.equal(removeAgent(directory).length, 5);
  assert.equal(fs.existsSync(directory), false);
  assert.deepEqual(agentStatus(directory), { present: false, version: undefined, current: false, key: false, config: undefined, state: undefined });
}));

test("the agent's directory stays when something not of ours is in it", () => withDirectory((parent) => {
  const directory = path.join(parent, "agent");
  installAgent(directory, { port: 4321, endpoint: "https://c.test" }, packagedFiles(study));
  fs.writeFileSync(path.join(directory, "notes.txt"), "mine");
  removeAgent(directory);
  assert.deepEqual(fs.readdirSync(directory), ["notes.txt"]);
}));

test("a filter's version is read from its text", () => {
  assert.equal(filterVersion('// x\nexport const version = "1.2.3";\n'), "1.2.3");
  assert.equal(filterVersion("export const version = 3;"), undefined);
  assert.equal(filterVersion(undefined), undefined);
});

test("a settings file says who wrote it, and leave takes out only our block", () => withDirectory((directory) => {
  const file = path.join(directory, "tool", "otel.env");
  const block = settingsBlock("joined", agentSettings({ port: 4321 }), command);
  assert.equal(readSettings(file), undefined);
  assert.equal(removeSettings(file), "absent");

  writeSettings(file, block);
  assert.equal(mode(file), 0o600);
  assert.deepEqual([readSettings(file)?.writer, readSettings(file)?.others], ["joined", false]);
  assert.equal(removeSettings(file), "removed");
  assert.equal(fs.existsSync(file), false);

  writeSettings(file, `# my own\nexport OTEL_SERVICE_NAME=mine\n\n${block}`);
  assert.deepEqual([readSettings(file)?.writer, readSettings(file)?.others], ["joined", true]);
  assert.equal(removeSettings(file), "kept others");
  assert.equal(fs.readFileSync(file, "utf8"), "# my own\nexport OTEL_SERVICE_NAME=mine\n");

  assert.deepEqual([readSettings(file)?.writer, readSettings(file)?.others], ["other", true]);
  assert.equal(removeSettings(file), "not ours");
  assert.equal(fs.readFileSync(file, "utf8"), "# my own\nexport OTEL_SERVICE_NAME=mine\n");

  writeSettings(file, `OTEL_SERVICE_NAME=mine\n${block}`);
  assert.equal(removeSettings(file, { force: true }), "removed");

  writeSettings(file, block.replace("joined.", "by hand."));
  assert.equal(readSettings(file)?.writer, "by hand");
  writeSettings(file, settingsBlock("preview", agentSettings({ port: 1, environment: "preview" }), command));
  assert.equal(readSettings(file)?.writer, "preview");
  assert.match(fs.readFileSync(file, "utf8"), /^OTEL_RESOURCE_ATTRIBUTES=deployment\.environment\.name=preview$/m);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["otel.env"]);
}));

test("the agent's port is below every system's ephemeral range, and free", async () => {
  // Ports from 32768 are Linux's ephemeral ones, from 49152 macOS's and Windows'.
  assert.ok(agentPorts.last < 32768);
  const taken = [];
  const port = await freePort(() => (taken.push(1), 0.5));
  assert.equal(taken.length, 1);
  // Under the tests' own port mapping a listener may get another port than it asked for: the one it got is returned.
  assert.ok(Number.isInteger(port) && port > 0);
});
