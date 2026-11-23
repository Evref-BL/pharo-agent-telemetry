// The command as a participant runs it, in a home of its own: the service
// commands are recorded instead of run (PHARO_AGENT_TELEMETRY_DRY_RUN), so
// nothing is installed on the machine that runs the tests.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dpoPlaceholder, participantsPage } from "../src/generate.js";
import { describeRequest, recoverPreview, startPreview } from "../src/preview.js";
import { fakesMarker, installedDefinitions, serviceDefinition, serviceNames, stableNode } from "../src/service.js";
import { everySettingsFile, readSettings, settingsBlock, settingsFiles, agentSettings } from "../src/settings.js";
import { isStudyCollector, missingForJoin, studyCommand } from "../src/study.js";
import { allowlist, comparable, expectedSpans, filterFile, ruleFixtures, study, testKey, transformModule } from "./support.js";

const { catalog: builtIn, filter } = transformModule;
// The participants' commands, as the example study's package runs them.
const binary = new URL("../bin/pharo-agent-telemetry.js", import.meta.url).pathname;
const program = [binary, "--study", study.directory];
const command = studyCommand(study);
const forbidden = fs.readFileSync(new URL("./fixtures/forbidden.json", import.meta.url), "utf8");
const leaveText = "Left: sending stops at once. PLexus and the images now find the agent's port closed, and nothing else leaves this machine. Images keep running.";

/**
 * A home of its own for each test: its configuration directory, where the
 * service commands are recorded, and the command run in it.
 */
async function withHome(run) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pat-home-")));
  const config = path.join(home, "config");
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: config, APPDATA: "", PHARO_AGENT_TELEMETRY_DRY_RUN: path.join(home, "commands.jsonl") };
  const cli = (...args) => spawnSync(process.execPath, [...program, ...args], { env, encoding: "utf8" });
  const settings = { plexus: path.join(config, "plexus", "otel.env"), mcp: path.join(config, "pharo-mcp", "otel.env") };
  const agent = path.join(config, "pharo-agent-telemetry");
  try {
    return await run({ home, config, env, cli, settings, agent });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const mode = (file) => fs.statSync(file).mode & 0o777;

test("each tool's settings file is where that tool reads it, from this shell and from the desktop", () => {
  // A tool started from the desktop has no XDG_CONFIG_HOME: the settings go where it reads them too.
  assert.deepEqual(settingsFiles({ XDG_CONFIG_HOME: "/c" }, "linux", "/home/a"), ["/c/plexus/otel.env", "/c/pharo-mcp/otel.env", "/home/a/.config/plexus/otel.env", "/home/a/.config/pharo-mcp/otel.env"]);
  assert.deepEqual(settingsFiles({}, "linux", "/home/a"), ["/home/a/.config/plexus/otel.env", "/home/a/.config/pharo-mcp/otel.env"]);
  assert.deepEqual(settingsFiles({ XDG_CONFIG_HOME: "relative" }, "darwin", "/Users/a"), ["/Users/a/.config/plexus/otel.env", "/Users/a/.config/pharo-mcp/otel.env"]);
  assert.deepEqual(settingsFiles({ APPDATA: "C:\\Users\\A\\AppData\\Roaming" }, "win32", "C:\\Users\\A"), ["C:\\Users\\A\\AppData\\Roaming\\plexus\\otel.env", "C:\\Users\\A\\AppData\\Roaming\\pharo-mcp\\otel.env"]);
  // Pharo on Windows reads a C:/ XDG_CONFIG_HOME as relative, and MCP then reads %APPDATA%.
  assert.deepEqual(settingsFiles({ XDG_CONFIG_HOME: "C:\\x", APPDATA: "C:\\R" }, "win32", "C:\\Users\\A"), ["C:\\x\\plexus\\otel.env", "C:\\x\\pharo-mcp\\otel.env", "C:\\R\\plexus\\otel.env", "C:\\R\\pharo-mcp\\otel.env"]);
  const everywhere = everySettingsFile({ XDG_CONFIG_HOME: "/c" }, "linux", "/home/a");
  for (const file of ["/c/plexus/otel.env", "/home/a/.config/plexus/otel.env", "/home/a/.config/pharo-mcp/otel.env", "/c/pharo-agent/otel.env"]) assert.ok(everywhere.includes(file), file);
});

test("join installs the agent and points both tools at it without the token; leave removes all of it", () => withHome(({ home, config, env, cli, settings, agent }) => {
  const joined = cli("join", "--endpoint", "https://c.test/", "--token", "secret-token");
  assert.equal(joined.status, 0, joined.stderr);
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(joined.stdout)?.[1]);
  assert.ok(port > 0, joined.stdout);
  for (const file of Object.values(settings)) {
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /^# pharo-agent-telemetry: joined\. /);
    assert.match(text, new RegExp(`^OTEL_EXPORTER_OTLP_ENDPOINT=http://127\\.0\\.0\\.1:${port}$`, "m"));
    assert.match(text, /^OTEL_EXPORTER_OTLP_PROTOCOL=http\/json$/m);
    assert.match(text, /^OTEL_TRACES_EXPORTER=otlp$/m);
    assert.match(text, /^OTEL_RESOURCE_ATTRIBUTES=deployment\.environment\.name=field$/m);
    assert.match(text, /^# pharo-agent-telemetry: end$/m);
    assert.doesNotMatch(text, /secret-token|c\.test/);
    assert.equal(mode(file), 0o600);
    assert.equal(readSettings(file)?.writer, "joined");
  }
  assert.equal(fs.readFileSync(path.join(agent, "agent.mjs"), "utf8"), fs.readFileSync(new URL("../src/agent.js", import.meta.url), "utf8"));
  assert.equal(fs.readFileSync(path.join(agent, "telemetry-transform.mjs"), "utf8"), fs.readFileSync(filterFile, "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8")), { study: "example", port, endpoint: "https://c.test/", token: "secret-token" });
  assert.equal(mode(path.join(agent, "agent.json")), 0o600);
  const key = fs.readFileSync(path.join(agent, "telemetry-transform.key"), "utf8");
  assert.match(key, /^[0-9a-f]{64}\n$/);
  assert.equal(mode(path.join(agent, "telemetry-transform.key")), 0o600);
  const service = serviceDefinition({ home, env: { XDG_CONFIG_HOME: config }, agent: path.join(agent, "agent.mjs") });
  const definition = fs.readFileSync(service.file);
  // This node, by the path on PATH that outlives its upgrades when there is one.
  const { node } = stableNode(env);
  assert.ok(definition.includes(node) || definition.includes(Buffer.from(node, "utf16le")), node);
  const commands = fs.readFileSync(env.PHARO_AGENT_TELEMETRY_DRY_RUN, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(commands.length >= 2, JSON.stringify(commands));

  // Joining again keeps the port, so the tools' settings stay right, and the key, so ids still group.
  assert.equal(cli("join", "--endpoint", "https://c.test/", "--token", "secret-token").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8")).port, port);
  assert.equal(fs.readFileSync(path.join(agent, "telemetry-transform.key"), "utf8"), key);

  const status = cli("status").stdout;
  assert.match(status, /^Joined\./);
  assert.match(status, new RegExp(`on 127\\.0\\.0\\.1:${port}, sending to https://c\\.test/; up to date with @example/pharo-agent-study 0\\.1\\.0 and pharo-agent-telemetry`));
  for (const file of Object.values(settings)) assert.ok(status.includes(`${file} (joined)`), status);

  // A preview killed meanwhile left its backup.
  fs.writeFileSync(`${settings.mcp}.before-preview`, "OTEL_SDK_DISABLED=true\n");
  const left = cli("leave");
  assert.equal(left.status, 0, left.stderr);
  assert.ok(left.stdout.trimEnd().endsWith(leaveText), left.stdout);
  assert.match(left.stdout, /Stopped and removed the agent, its files and its key\./);
  for (const file of [...Object.values(settings), `${settings.mcp}.before-preview`, agent, service.file]) assert.equal(fs.existsSync(file), false, file);
  const after = cli("status").stdout;
  assert.match(after, /^Not joined\./);
  assert.match(after, /^Agent service: not installed\.$/m);
}));

test("join refuses before the collector exists, and never replaces settings it did not write unless forced", () => withHome(({ cli, settings, agent }) => {
  assert.match(cli("join").stderr, /its endpoint, token, controller, dpo, host, catalogUrl, catalogPublicKey are not set yet/);
  fs.mkdirSync(path.dirname(settings.mcp), { recursive: true });
  fs.writeFileSync(settings.mcp, "OTEL_EXPORTER_OTLP_ENDPOINT=http://mine\n");
  const refused = cli("join", "--endpoint", "https://c.test");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /join --force/);
  assert.equal(fs.readFileSync(settings.mcp, "utf8"), "OTEL_EXPORTER_OTLP_ENDPOINT=http://mine\n");
  assert.equal(fs.existsSync(agent), false);
  // Leave leaves a file without a block of ours as it is.
  assert.equal(cli("leave").status, 0);
  assert.equal(fs.readFileSync(settings.mcp, "utf8"), "OTEL_EXPORTER_OTLP_ENDPOINT=http://mine\n");
  assert.equal(cli("join", "--endpoint", "https://c.test", "--force").status, 0);
  assert.equal(readSettings(settings.mcp)?.writer, "joined");
  assert.equal(readSettings(settings.mcp)?.others, false);
}));

test("leave finds a block wherever a tool may have read it, and keeps the settings of your own beside it", () => withHome(({ home, cli, settings, config }) => {
  const block = settingsBlock("joined", agentSettings({ port: 4321 }), command);
  const elsewhere = path.join(home, ".config", "plexus", "otel.env");
  const earlier = path.join(config, "pharo-agent", "otel.env");
  const yours = path.join(home, ".config", "pharo-mcp", "otel.env");
  for (const [file, text] of [[elsewhere, block], [earlier, block], [settings.mcp, `# mine\nOTEL_SERVICE_NAME=mine\n${block}`], [yours, "OTEL_SERVICE_NAME=mine\n"]]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const left = cli("leave");
  assert.equal(left.status, 0, left.stderr);
  assert.equal(fs.existsSync(elsewhere), false);
  assert.equal(fs.existsSync(earlier), false);
  assert.equal(fs.readFileSync(settings.mcp, "utf8"), "# mine\nOTEL_SERVICE_NAME=mine\n");
  assert.equal(fs.readFileSync(yours, "utf8"), "OTEL_SERVICE_NAME=mine\n");
  assert.match(left.stdout, /settings of your own in it stay/);
}));

test("status says when the agent is older than the package, has lost its key, or a tool's block is gone", () => withHome(async ({ cli, env, agent, settings }) => {
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const transform = path.join(agent, "telemetry-transform.mjs");
  fs.writeFileSync(transform, fs.readFileSync(transform, "utf8").replace(/^export const version = "[^"]+";$/m, 'export const version = "0.0.1";'));
  fs.rmSync(path.join(agent, "telemetry-transform.key"));
  fs.rmSync(settings.mcp);
  const status = cli("status").stdout;
  assert.match(status, /its filter of version 0\.0\.1, not up to date with @example\/pharo-agent-study 0\.1\.0 and pharo-agent-telemetry [0-9.]+: run join again to update it/);
  assert.match(status, /its key is missing, so it sends nothing/);
  assert.ok(status.includes(`${settings.mcp}: no block of ours, so the tool that reads it sends nothing. Run join again.`), status);
  // Something on the agent's port, which status cannot tell from the agent without its key.
  const { port } = JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8"));
  const listener = http.createServer((request, response) => response.writeHead(404).end());
  await new Promise((resolve) => listener.listen(port, "127.0.0.1", () => resolve(undefined)));
  try {
    const seen = await new Promise((resolve) => execFile(process.execPath, [...program, "status"], { env }, (error, stdout) => resolve(stdout)));
    assert.match(seen, new RegExp(`^Something listens on 127\\.0\\.0\\.1:${port}; without the agent's key`, "m"));
  } finally {
    await new Promise((resolve) => listener.close(() => resolve(undefined)));
  }
}));

test("a preview prints what the agent would send, sends nothing, and puts the settings back", () => withHome(async ({ settings }) => {
  fs.mkdirSync(path.dirname(settings.plexus), { recursive: true });
  const joined = settingsBlock("joined", agentSettings({ port: 4321 }), command);
  fs.writeFileSync(settings.plexus, joined);
  const printed = [];
  const stop = new AbortController();
  const { port, done } = await startPreview({ files: Object.values(settings), filter, key: testKey, print: (line) => printed.push(line), signal: stop.signal, command });
  for (const file of Object.values(settings)) {
    assert.equal(readSettings(file)?.writer, "preview");
    assert.match(fs.readFileSync(file, "utf8"), new RegExp(`^OTEL_EXPORTER_OTLP_ENDPOINT=http://127\\.0\\.0\\.1:${port}$`, "m"));
    assert.match(fs.readFileSync(file, "utf8"), /^OTEL_RESOURCE_ATTRIBUTES=deployment\.environment\.name=preview$/m);
  }
  const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, { method: "POST", body: forbidden, headers: { "content-type": "application/json" } });
  assert.equal(response.status, 200);
  for (let attempt = 0; attempt < 50 && printed.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  stop.abort();
  await done;
  assert.equal(fs.readFileSync(settings.plexus, "utf8"), joined);
  assert.equal(fs.existsSync(settings.mcp), false);
  assert.equal(fs.existsSync(`${settings.plexus}.before-preview`), false);
  const text = printed.join("\n");
  assert.match(text, /^tools\/call image_list \(server, week of \d{4}-\d{2}-\d{2}\) trace [0-9a-f]{32} span [0-9a-f]{16}/m);
  for (const secret of ["adas-laptop", "/Users/ada", "acme", "4bf92f3577b34da6a3ce929d0e0e4736"]) assert.equal(text.includes(secret), false, secret);
}));

for (const signal of ["SIGHUP", "SIGINT"]) {
  test(`the preview command puts the settings back on ${signal}`, () => withHome(async ({ env, settings }) => {
    fs.mkdirSync(path.dirname(settings.plexus), { recursive: true });
    fs.writeFileSync(settings.plexus, "OTEL_SERVICE_NAME=mine\n");
    const child = spawn(process.execPath, [...program, "preview"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 100 && !output.includes("Previewing on"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.match(output, /Previewing on 127\.0\.0\.1:\d+/);
    assert.equal(readSettings(settings.plexus)?.writer, "preview");
    assert.equal(readSettings(settings.mcp)?.writer, "preview");
    const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    child.kill(signal);
    assert.equal(await exited, 0, output);
    assert.equal(fs.readFileSync(settings.plexus, "utf8"), "OTEL_SERVICE_NAME=mine\n");
    assert.equal(fs.existsSync(settings.mcp), false);
    assert.equal(fs.existsSync(`${settings.plexus}.before-preview`), false);
  }));
}

test("a preview that was killed is put back as it was, or removed when there was nothing", () => withHome(({ settings }) => {
  fs.mkdirSync(path.dirname(settings.plexus), { recursive: true });
  const preview = settingsBlock("preview", agentSettings({ port: 4321, environment: "preview" }), command);
  fs.writeFileSync(settings.plexus, preview);
  fs.writeFileSync(`${settings.plexus}.before-preview`, "OTEL_SERVICE_NAME=mine\n");
  recoverPreview(settings.plexus);
  assert.equal(fs.readFileSync(settings.plexus, "utf8"), "OTEL_SERVICE_NAME=mine\n");
  assert.equal(fs.existsSync(`${settings.plexus}.before-preview`), false);
  fs.writeFileSync(settings.plexus, preview);
  recoverPreview(settings.plexus);
  assert.equal(fs.existsSync(settings.plexus), false);
}));

test("a span is described with its week, ids, attributes and where it ran", () => {
  const [fixture] = ruleFixtures().filter(({ name }) => name === "kept-and-dropped");
  const kept = filter(testKey, { offsets: false })("traces", fixture.request);
  const lines = describeRequest(kept);
  const [span] = expectedSpans(fixture);
  assert.ok(lines.some((line) => line.startsWith(`${span.name} (${["unspecified", "internal", "server", "client"][span.kind]}, week of `) && line.includes(`trace ${span.trace}`)), lines.join("\n"));
  assert.ok(lines.includes('    mcp.method.name = "tools/call"'), lines.join("\n"));
  assert.ok(lines.some((line) => /^ {4}span\.duration_ms = [0-9.]+$/.test(line)), lines.join("\n"));
  assert.ok(lines.some((line) => /^ {2}from (@evref-bl\/plexus [0-9.]+|mcp-pharo):$/.test(line)), lines.join("\n"));
  assert.deepEqual(comparable([kept]), expectedSpans(fixture));
});

test("the page names who answers for the data, its officer and where it is once they are set, and says so while they are not", () => {
  const unset = participantsPage(allowlist, { ...study, collector: {} });
  assert.match(unset, /The controller and how to reach them: not set yet/);
  assert.match(unset, /Where the collector runs, the GitLab that copies its archive, and where the archive is kept: not set yet/);
  assert.ok(unset.includes(dpoPlaceholder));
  const set = participantsPage(allowlist, { ...study, collector: {
    endpoint: "https://c.test",
    token: "t",
    controller: { name: "Example SA", contact: "privacy@example.test" },
    dpo: "dpo@example.test",
    host: { provider: "Example Cloud", region: "Paris", importer: "Example's GitLab", archive: "Example's Elasticsearch, in France" },
  } });
  assert.doesNotMatch(set, /not set yet/);
  assert.equal(set.includes(dpoPlaceholder), false);
  assert.match(set, /Example SA decides why and how/);
  assert.match(set, /privacy@example\.test/);
  assert.match(set, /officer can be reached at dpo@example\.test/);
  assert.match(set, /Example Cloud hosts the virtual machine the collector runs on, in Paris/);
  assert.match(set, /a scheduled job in Example's GitLab copies/);
  assert.match(set, /Example's Elasticsearch, in France keeps it/);
  assert.match(set, /consent/);
  assert.match(set, /CNIL/);
});

test("join --endpoint naming the study's collector, however written, joins it as the study's", () => {
  const ours = "https://telemetry.example.org";
  for (const given of [undefined, ours, `${ours}/`, "https://TELEMETRY.example.org", "https://telemetry.example.org:443/"]) assert.equal(isStudyCollector(given, ours), true, String(given));
  for (const given of ["https://other.example.org", "http://telemetry.example.org", "https://telemetry.example.org/elsewhere", "not a url"]) assert.equal(isStudyCollector(given, ours), false, given);
  // Before the study's collector exists, any --endpoint is another's.
  assert.equal(isStudyCollector("https://c.test", undefined), false);
  assert.equal(isStudyCollector(undefined, undefined), true);
});

test("join refuses the study's collector while anything about it is missing", () => {
  assert.deepEqual(missingForJoin({}), ["endpoint", "token", "controller", "dpo", "host", "catalogUrl", "catalogPublicKey"]);
  const ready = { endpoint: "https://c.test", token: "t", controller: { name: "n", contact: "c" }, dpo: "d", host: { provider: "p", region: "r", importer: "i", archive: "a" }, catalogUrl: "https://c.test/pharo-agent-telemetry/catalog.json", catalogPublicKey: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
  assert.deepEqual(missingForJoin(ready), []);
  // The catalog comes from the collector's own host, and no other.
  assert.deepEqual(missingForJoin({ ...ready, catalogUrl: "https://elsewhere.test/pharo-agent-telemetry/catalog.json" }), ["catalogUrl"]);
  assert.deepEqual(missingForJoin({ ...ready, catalogUrl: "http://c.test/pharo-agent-telemetry/catalog.json" }), ["catalogUrl"]);
});

/**
 * Fake service commands for the system the tests run on, which append how
 * they were called to a log; a bootstrap or an enable fails when
 * PAT_FAKE_FAIL is set.
 */
function fakeServiceCommands(home) {
  const fakes = path.join(home, "fakes");
  const log = path.join(home, "service.log");
  fs.mkdirSync(fakes);
  fs.writeFileSync(log, "");
  for (const name of ["launchctl", "systemctl", "schtasks"]) {
    fs.writeFileSync(path.join(fakes, name), `#!/bin/sh\necho "${name} $*" >> "$PAT_FAKE_LOG"\ncase "$1 $2" in bootstrap*|*" enable") [ -n "$PAT_FAKE_FAIL" ] && exit 5;; esac\nexit 0\n`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(fakes, fakesMarker), "");
  return { fakes, log, calls: () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean), clear: () => fs.writeFileSync(log, "") };
}

/** The environment of a home under `root`, with the fake service commands instead of the dry run. */
function fakedHome(env, root, fakes, log) {
  const faked = { ...env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, "config"), PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS: fakes, PAT_FAKE_LOG: log };
  delete faked.PHARO_AGENT_TELEMETRY_DRY_RUN;
  return faked;
}

const run = (environment, ...args) => spawnSync(process.execPath, [...program, ...args], { env: environment, encoding: "utf8" });

test("leave, status and join in a scratch home act on no other home's service, even with its definition copied in", { skip: process.platform === "win32" }, () => withHome(({ home, env }) => {
  const { fakes, log, calls, clear } = fakeServiceCommands(home);
  // Another home, joined: as the participant's own agent is for a reviewer's scratch home.
  const otherRoot = path.join(home, "participant");
  const other = fakedHome(env, otherRoot, fakes, log);
  assert.equal(run(other, "join", "--endpoint", "https://c.test").status, 0);
  const otherAgent = path.join(otherRoot, "config", "pharo-agent-telemetry", "agent.mjs");
  const otherNames = serviceNames(otherAgent);
  const otherDefinitions = installedDefinitions({ home: otherRoot, env: other, agent: otherAgent });
  assert.ok(otherDefinitions.length > 0);
  clear();

  const scratchRoot = path.join(home, "scratch");
  const scratch = fakedHome(env, scratchRoot, fakes, log);
  const left = run(scratch, "leave");
  assert.equal(left.status, 0, left.stderr);
  assert.deepEqual(calls(), []);
  // The other home's definitions, copied into the scratch home where its own would be.
  for (const file of otherDefinitions) {
    const copy = path.join(scratchRoot, path.relative(otherRoot, file));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(file, copy);
  }
  assert.equal(run(scratch, "leave").status, 0);
  assert.match(run(scratch, "status").stdout, /^Agent service: not installed\.$/m);
  assert.deepEqual(calls(), []);

  // Joined and left in turn, the scratch home names its own service alone.
  assert.equal(run(scratch, "join", "--endpoint", "https://c.test").status, 0);
  assert.equal(run(scratch, "leave").status, 0);
  const ours = serviceNames(path.join(scratchRoot, "config", "pharo-agent-telemetry", "agent.mjs"));
  const named = calls();
  assert.ok(named.some((line) => line.includes(ours.label) || line.includes(ours.unit)), named.join("\n"));
  for (const line of named) {
    assert.equal([otherNames.label, otherNames.unit, otherNames.task].some((name) => line.includes(name)), false, line);
    assert.ok(/daemon-reload$/.test(line) || line.includes(ours.label) || line.includes(ours.unit), line);
  }
  for (const file of otherDefinitions) assert.ok(fs.existsSync(file), file);
}));

test("a join the service manager refuses leaves nothing behind, and says why", { skip: process.platform === "win32" }, () => withHome(({ home, env }) => {
  const { fakes, log } = fakeServiceCommands(home);
  const root = path.join(home, "refused");
  const refusing = { ...fakedHome(env, root, fakes, log), PAT_FAKE_FAIL: "1" };
  const mine = path.join(root, "config", "pharo-mcp", "otel.env");
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, "# my notes\n");
  const refused = run(refusing, "join", "--endpoint", "https://c.test");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /service manager refused it/);
  assert.match(refused.stderr, /Nothing was installed, and nothing is sent\./);
  assert.match(refused.stderr, /run join --no-service, then keep `npx @example\/pharo-agent-study agent` running/);
  assert.equal(fs.existsSync(path.join(root, "config", "pharo-agent-telemetry")), false);
  assert.deepEqual(installedDefinitions({ home: root, env: refusing, agent: path.join(root, "config", "pharo-agent-telemetry", "agent.mjs") }), []);
  assert.equal(fs.readFileSync(mine, "utf8"), "# my notes\n");
  assert.equal(fs.existsSync(`${mine}.before-join`), false);
  assert.equal(fs.existsSync(path.join(root, "config", "plexus", "otel.env")), false);
}));

test("join writes where the desktop's tools read too, quiets the images, and makes PLexus forget it could not reach the agent", () => withHome(({ home, config, cli, settings }) => {
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const port = JSON.parse(fs.readFileSync(path.join(config, "pharo-agent-telemetry", "agent.json"), "utf8")).port;
  for (const file of [...Object.values(settings), path.join(home, ".config", "plexus", "otel.env"), path.join(home, ".config", "pharo-mcp", "otel.env")]) {
    assert.equal(readSettings(file)?.writer, "joined", file);
    assert.match(fs.readFileSync(file, "utf8"), /^OTEL_LOG_LEVEL=none$/m);
  }
  const reachability = path.join(home, ".cache", "plexus", "otel-reachability.json");
  fs.mkdirSync(path.dirname(reachability), { recursive: true });
  const elsewhere = { "https://elsewhere.test/v1/traces": { failures: 1, retryAt: Date.now() + 60_000 } };
  fs.writeFileSync(reachability, JSON.stringify({ [`http://127.0.0.1:${port}/v1/traces`]: { failures: 3, retryAt: Date.now() + 3_600_000 }, ...elsewhere }));
  const joined = cli("join", "--endpoint", "https://c.test");
  assert.equal(joined.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(reachability, "utf8")), elsewhere);
  assert.match(joined.stdout, /Restart your agent host/);
  assert.match(joined.stdout, /MCP useOpenTelemetryObservabilityByDefault/);
}));

test("an agent on an ephemeral port from an earlier join moves below the ephemeral ranges", () => withHome(({ config, cli }) => {
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const file = path.join(config, "pharo-agent-telemetry", "agent.json");
  fs.writeFileSync(file, JSON.stringify({ port: 61149, endpoint: "https://c.test" }));
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const { port } = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(port < 32768, String(port));
}));

test("settings of your own are put back as they were on leave, and status never shows their values", () => withHome(({ cli, settings }) => {
  fs.mkdirSync(path.dirname(settings.mcp), { recursive: true });
  const mine = "# mine\nOTEL_EXPORTER_OTLP_ENDPOINT=https://mine.test\nOTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer s3cret\n";
  fs.writeFileSync(settings.mcp, mine);
  assert.equal(cli("join", "--endpoint", "https://c.test", "--force").status, 0);
  assert.equal(fs.readFileSync(`${settings.mcp}.before-join`, "utf8"), mine);
  // A block of ours beside settings of your own: status names them, never their values.
  fs.writeFileSync(settings.plexus, `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer s3cret\n${fs.readFileSync(settings.mcp, "utf8")}`);
  const status = cli("status").stdout;
  assert.equal(status.includes("s3cret"), false, status);
  assert.match(status, /settings of your own, values not shown: OTEL_EXPORTER_OTLP_HEADERS/);
  assert.match(status, /^Nothing listens on 127\.0\.0\.1:\d+, so nothing is sent\. Run join again to start it\.$/m);
  assert.equal(cli("leave").status, 0);
  assert.equal(fs.readFileSync(settings.mcp, "utf8"), mine);
  assert.equal(fs.existsSync(`${settings.mcp}.before-join`), false);
  assert.equal(fs.readFileSync(settings.plexus, "utf8"), "OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer s3cret\n");
}));

/** Runs the preview command until `until` holds of what it printed. */
async function startedPreview(env, until) {
  const child = spawn(process.execPath, [...program, "preview"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const output = { text: "" };
  child.stdout.on("data", (chunk) => { output.text += chunk; });
  child.stderr.on("data", (chunk) => { output.text += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  for (let attempt = 0; attempt < 100 && !until(output.text); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  return { child, output, exited };
}

test("joined, the preview takes the agent's port while it runs, and starts the agent again after, unless leave ran meanwhile", () => withHome(async ({ config, env, cli, settings }) => {
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const port = JSON.parse(fs.readFileSync(path.join(config, "pharo-agent-telemetry", "agent.json"), "utf8")).port;
  const joined = fs.readFileSync(settings.plexus, "utf8");
  fs.writeFileSync(env.PHARO_AGENT_TELEMETRY_DRY_RUN, "");
  const { child, output, exited } = await startedPreview(env, (text) => text.includes("Previewing on"));
  assert.match(output.text, new RegExp(`Previewing on 127\\.0\\.0\\.1:${port}, the agent's port`));
  // The tools' settings already point at the agent's port: left as they are.
  assert.equal(fs.readFileSync(settings.plexus, "utf8"), joined);
  assert.equal((await fetch(`http://127.0.0.1:${port}/v1/traces`, { method: "POST", body: forbidden, headers: { "content-type": "application/json" } })).status, 200);
  for (let attempt = 0; attempt < 50 && !output.text.includes("tools/call image_list (server"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  child.kill("SIGINT");
  assert.equal(await exited, 0, output.text);
  assert.match(output.text, /The agent runs again\./);
  const names = serviceNames(path.join(config, "pharo-agent-telemetry", "agent.mjs"));
  const started = fs.readFileSync(env.PHARO_AGENT_TELEMETRY_DRY_RUN, "utf8");
  assert.ok([names.label, names.unit, names.task].some((name) => started.includes(name)) && /kickstart|"start"|\/Run/.test(started), started);

  const second = await startedPreview(env, (text) => text.includes("Previewing on"));
  assert.equal(cli("leave").status, 0);
  second.child.kill("SIGINT");
  assert.equal(await second.exited, 0, second.output.text);
  assert.match(second.output.text, /The agent is not started again: its service is gone\./);
  assert.doesNotMatch(second.output.text, /ENOENT/);
}));

test("another study's join and preview are refused while this home's service runs an agent joined from a shell with another XDG_CONFIG_HOME", { skip: process.platform === "win32" }, () => withHome(({ home, env }) => {
  const { fakes, log } = fakeServiceCommands(home);
  const root = path.join(home, "participant");
  const joining = { ...fakedHome(env, root, fakes, log), XDG_CONFIG_HOME: path.join(root, "xdg") };
  assert.equal(run(joining, "join", "--endpoint", "https://c.test").status, 0);
  const other = path.join(home, "other-study");
  fs.cpSync(study.directory, other, { recursive: true });
  fs.writeFileSync(path.join(other, "study.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(other, "study.json"), "utf8")), id: "other" }));
  const shell = { ...joining };
  delete shell.XDG_CONFIG_HOME;
  for (const command of ["join", "preview"]) {
    const refused = spawnSync(process.execPath, [binary, "--study", other, command, "--endpoint", "https://c.test"], { env: shell, encoding: "utf8" });
    assert.equal(refused.status, 1, command);
    assert.match(refused.stderr, /You joined the study example \(.*xdg.*\): run leave first/, command);
  }
  // Nothing of the other study was written: the agent still sends for the one joined.
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "xdg", "pharo-agent-telemetry", "agent.json"), "utf8")).study, "example");
  assert.equal(run(shell, "leave").status, 0);
}));

test("leave and status from a shell without join's XDG_CONFIG_HOME find the agent from this home's service definitions, and the settings beside it", { skip: process.platform === "win32" }, () => withHome(({ home, env }) => {
  const { fakes, log } = fakeServiceCommands(home);
  const root = path.join(home, "participant");
  const joining = { ...fakedHome(env, root, fakes, log), XDG_CONFIG_HOME: path.join(root, "xdg") };
  assert.equal(run(joining, "join", "--endpoint", "https://c.test").status, 0);
  const directory = path.join(root, "xdg", "pharo-agent-telemetry");
  const beside = [path.join(root, "xdg", "plexus", "otel.env"), path.join(root, "xdg", "pharo-mcp", "otel.env")];
  for (const file of beside) assert.equal(readSettings(file)?.writer, "joined", file);
  const shell = { ...joining };
  delete shell.XDG_CONFIG_HOME;
  const status = run(shell, "status").stdout;
  assert.ok(status.includes(`Agent: ${directory}, of the study example on 127.0.0.1:`), status);
  const left = run(shell, "leave");
  assert.equal(left.status, 0, left.stderr);
  for (const file of beside) assert.equal(fs.existsSync(file), false, file);
  assert.equal(fs.existsSync(directory), false);
  assert.deepEqual(installedDefinitions({ home: root, env: joining, agent: path.join(directory, "agent.mjs") }), []);
  assert.match(left.stdout, /Stopped and removed the agent/);
}));

test("join writes through a settings file's symbolic link, and leave puts back what the file it points to held", { skip: process.platform === "win32" }, () => withHome(({ home, cli, settings }) => {
  const real = path.join(home, "dotfiles", "pharo-mcp.env");
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, "# my notes\n", { mode: 0o644 });
  fs.chmodSync(real, 0o644);
  fs.mkdirSync(path.dirname(settings.mcp), { recursive: true });
  fs.symlinkSync(real, settings.mcp);
  const joined = cli("join", "--endpoint", "https://c.test");
  assert.equal(joined.status, 0, joined.stderr);
  assert.ok(fs.lstatSync(settings.mcp).isSymbolicLink());
  assert.equal(readSettings(real)?.writer, "joined");
  // The file keeps its permissions; only the backup is its owner's alone.
  assert.equal(mode(real), 0o644);
  assert.equal(fs.readFileSync(`${settings.mcp}.before-join`, "utf8"), "# my notes\n");
  assert.equal(mode(`${settings.mcp}.before-join`), 0o600);
  assert.ok(joined.stdout.includes(`What was yours: ${settings.mcp}.before-join, which leave puts back.`), joined.stdout);
  const left = cli("leave");
  assert.equal(left.status, 0, left.stderr);
  assert.ok(fs.lstatSync(settings.mcp).isSymbolicLink());
  assert.equal(fs.readFileSync(real, "utf8"), "# my notes\n");
  assert.equal(mode(real), 0o644);
  assert.equal(fs.existsSync(`${settings.mcp}.before-join`), false);
}));

test("join refuses a settings file it cannot read or write, and a backup older than the file, before installing anything", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => withHome(({ cli, settings, agent }) => {
  const nothingInstalled = (result, message) => {
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, message);
    assert.equal(fs.existsSync(agent), false);
  };
  fs.mkdirSync(path.dirname(settings.mcp), { recursive: true });
  fs.writeFileSync(settings.mcp, "OTEL_SERVICE_NAME=mine\n", { mode: 0o000 });
  nothingInstalled(cli("join", "--endpoint", "https://c.test", "--force"), /otel\.env cannot be read: join would replace it without keeping it/);
  fs.chmodSync(settings.mcp, 0o600);

  fs.mkdirSync(path.dirname(settings.plexus), { recursive: true, mode: 0o500 });
  fs.chmodSync(path.dirname(settings.plexus), 0o500);
  nothingInstalled(cli("join", "--endpoint", "https://c.test", "--force"), /plexus\/otel\.env cannot be written \(EACCES\): join would stop halfway/);
  fs.chmodSync(path.dirname(settings.plexus), 0o700);

  fs.writeFileSync(`${settings.mcp}.before-join`, "OTEL_SERVICE_NAME=older\n");
  nothingInstalled(cli("join", "--endpoint", "https://c.test", "--force"), /before-join holds what .* held before an earlier join, and .* has changed since/);
  fs.rmSync(settings.mcp);
  nothingInstalled(cli("join", "--endpoint", "https://c.test", "--force"), /and .*otel\.env is gone since/);
  // A backup that holds what the file holds is the same: taken as it is.
  fs.writeFileSync(settings.mcp, "OTEL_SERVICE_NAME=older\n");
  assert.equal(cli("join", "--endpoint", "https://c.test", "--force").status, 0);
  assert.equal(cli("leave").status, 0);
  assert.equal(fs.readFileSync(settings.mcp, "utf8"), "OTEL_SERVICE_NAME=older\n");
  assert.equal(fs.existsSync(`${settings.mcp}.before-join`), false);
}));

test("leave says where a backup it does not put back is", () => withHome(({ cli, settings }) => {
  fs.mkdirSync(path.dirname(settings.mcp), { recursive: true });
  fs.writeFileSync(settings.mcp, "OTEL_SERVICE_NAME=mine\n");
  fs.mkdirSync(path.dirname(settings.plexus), { recursive: true });
  fs.writeFileSync(settings.plexus, "OTEL_SERVICE_NAME=mine\n");
  assert.equal(cli("join", "--endpoint", "https://c.test", "--force").status, 0);
  // Settings of your own added beside the block since, and a file you wrote again whole.
  fs.appendFileSync(settings.mcp, "OTEL_SERVICE_NAMESPACE=later\n");
  fs.writeFileSync(settings.plexus, "OTEL_SERVICE_NAME=again\n");
  const left = cli("leave");
  assert.equal(left.status, 0, left.stderr);
  assert.ok(left.stdout.includes(`Removed the block from ${settings.mcp}; the settings of your own in it stay. What it held before join is in ${settings.mcp}.before-join.`), left.stdout);
  assert.ok(left.stdout.includes(`${settings.plexus} holds no block of ours: left as it is. What it held before join is in ${settings.plexus}.before-join.`), left.stdout);
  assert.equal(fs.readFileSync(settings.mcp, "utf8"), "OTEL_SERVICE_NAMESPACE=later\n");
  assert.equal(fs.readFileSync(settings.plexus, "utf8"), "OTEL_SERVICE_NAME=again\n");
  assert.equal(fs.readFileSync(`${settings.mcp}.before-join`, "utf8"), "OTEL_SERVICE_NAME=mine\n");
}));

test("join --no-service installs no service, and says the agent sends only while the agent command runs", () => withHome(({ home, env, cli, agent }) => {
  const joined = cli("join", "--endpoint", "https://c.test", "--no-service");
  assert.equal(joined.status, 0, joined.stderr);
  assert.match(joined.stdout, /No service runs the agent: it sends only while `npx @example\/pharo-agent-study agent` runs\./);
  assert.equal(JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8")).service, false);
  assert.deepEqual(installedDefinitions({ home, env, agent: path.join(agent, "agent.mjs") }), []);
  assert.equal(fs.existsSync(env.PHARO_AGENT_TELEMETRY_DRY_RUN) ? fs.readFileSync(env.PHARO_AGENT_TELEMETRY_DRY_RUN, "utf8") : "", "");
  const status = cli("status").stdout;
  assert.match(status, /^Agent service: none: join --no-service, so it sends only while the agent command runs\.$/m);
  assert.match(status, /so nothing is sent\. Run the agent command to send\.$/m);
  // Joined with a service again, the agent has one.
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8")).service, undefined);
  assert.ok(installedDefinitions({ home, env, agent: path.join(agent, "agent.mjs") }).length > 0);
}));

test("status and join know a joined preview from another program, and a preview killed before it started the agent again", () => withHome(async ({ config, env, cli }) => {
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const port = JSON.parse(fs.readFileSync(path.join(config, "pharo-agent-telemetry", "agent.json"), "utf8")).port;
  const { child, output, exited } = await startedPreview(env, (text) => text.includes("Previewing on"));
  assert.match(output.text, /Previewing on/);
  const status = cli("status").stdout;
  assert.ok(status.includes(`A preview runs on 127.0.0.1:${port}, in the agent's place: nothing is sent until it ends and starts the agent again.`), status);
  const refused = cli("join", "--endpoint", "https://c.test");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /A preview runs in the agent's place\. Stop it first\./);
  child.kill("SIGKILL");
  await exited;
  assert.match(cli("status").stdout, /a preview was stopped without starting the agent again\. Run join again to start it\./);
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  assert.equal(fs.existsSync(path.join(config, "pharo-agent-telemetry", "preview.json")), false);
  assert.doesNotMatch(cli("status").stdout, /preview was stopped/);
}));

test("status shows the catalog of names the agent filters with: its date, the releases it was read from, and where it came from", () => withHome(({ cli, agent }) => {
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const releases = Object.entries(builtIn.releases).map(([name, release]) => `${name} ${release}`).join(", ");
  assert.ok(cli("status").stdout.includes(`Catalog of the names kept: the package's, of ${builtIn.published}, read from ${releases}; it asks for none, sending to another collector than its study's.`));
  const config = JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8"));
  fs.writeFileSync(path.join(agent, "agent.json"), JSON.stringify({ ...config, catalog: { url: "https://c.test/pharo-agent-telemetry/catalog.json", publicKey: "k" } }));
  const checked = new Date(Date.now() - 3 * 3_600_000).toISOString();
  fs.writeFileSync(path.join(agent, "state.json"), JSON.stringify({ started: checked, received: {}, forwarded: {}, catalog: { published: "2030-01-01T00:00:00.000Z", releases: { MCP: "v9.0.0" }, from: "https://c.test/pharo-agent-telemetry/catalog.json", added: { "MCP tools": ["new_tool"], "project words": ["zzqx", "ok2"] }, checked, outcome: "accepted" } }));
  const status = cli("status").stdout;
  assert.match(status, /^Catalog of the names kept: from https:\/\/c\.test\/pharo-agent-telemetry\/catalog\.json, of 2030-01-01T00:00:00\.000Z, read from MCP v9\.0\.0; asked for a newer one 3 h ago: accepted\.$/m);
  assert.match(status, /^It adds to the package's lists: MCP tools: new_tool; project words: zzqx, ok2\.$/m);
}));

test("join refuses while a preview answers, and puts back what one that was killed left: a stale mark or a reused process id stops nothing", () => withHome(async ({ env, cli, settings, agent }) => {
  fs.mkdirSync(path.dirname(settings.mcp), { recursive: true });
  fs.writeFileSync(settings.mcp, "# my notes\n");
  // Not joined, the preview writes its own block in the settings files.
  const { child, exited } = await startedPreview(env, (text) => text.includes("Previewing on"));
  assert.equal(readSettings(settings.mcp)?.writer, "preview");
  const refused = cli("join", "--endpoint", "https://c.test");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /A preview is running\. Stop it first\./);
  child.kill("SIGKILL");
  await exited;
  const joined = cli("join", "--endpoint", "https://c.test");
  assert.equal(joined.status, 0, joined.stderr);
  assert.equal(readSettings(settings.mcp)?.writer, "joined");
  assert.equal(fs.readFileSync(`${settings.mcp}.before-join`, "utf8"), "# my notes\n");
  // A mark a joined preview left, naming a process id another process holds now, is no preview.
  fs.writeFileSync(path.join(agent, "preview.json"), JSON.stringify({ pid: process.pid, port: 1 }));
  assert.match(cli("status").stdout, /a preview was stopped without starting the agent again\. Run join again to start it\./);
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  assert.equal(fs.existsSync(path.join(agent, "preview.json")), false);
  assert.equal(cli("leave").status, 0);
  assert.equal(fs.readFileSync(settings.mcp, "utf8"), "# my notes\n");
}));

test("where the service manager may not be asked, each command says so in one line, and a refused join leaves nothing behind", { skip: process.platform === "win32" }, () => withHome(({ home, env }) => {
  const { fakes, log } = fakeServiceCommands(home);
  const root = path.join(home, "guarded");
  const faked = fakedHome(env, root, fakes, log);
  const guarded = { ...faked };
  delete guarded.PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS;
  const agentFile = path.join(root, "config", "pharo-agent-telemetry", "agent.mjs");
  const oneLine = (result) => {
    assert.doesNotMatch(result.stderr, /\n\s+at /);
    assert.ok(result.stderr.trim().split("\n").length <= 1, result.stderr);
  };
  const refused = run(guarded, "join", "--endpoint", "https://c.test");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^Could not start the agent as a service: (launchctl|systemctl) is not run: service commands are not run under a test\. Nothing was installed, and nothing is sent\. To join without a service, run join --no-service/);
  oneLine(refused);
  assert.equal(fs.existsSync(path.dirname(agentFile)), false);
  assert.deepEqual(installedDefinitions({ home: root, env: guarded, agent: agentFile }), []);
  // Joined with the fakes, then asked from where the service manager may not be.
  assert.equal(run(faked, "join", "--endpoint", "https://c.test").status, 0);
  const status = run(guarded, "status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^Agent service: not asked \((launchctl|systemctl) is not run: service commands are not run under a test\)\.$/m);
  oneLine(status);
  const left = run(guarded, "leave");
  assert.equal(left.status, 0, left.stderr);
  assert.match(left.stdout, /The service manager was not asked to stop the agent's service \((launchctl|systemctl) is not run: .*\): its definition is removed, so it does not start again at the next login\./);
  assert.deepEqual(installedDefinitions({ home: root, env: guarded, agent: agentFile }), []);
  assert.equal(fs.existsSync(path.dirname(agentFile)), false);
  // No other directory's commands run instead of the real ones, and no dry run outside a test.
  const other = run({ ...faked, PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS: "/bin" }, "join", "--endpoint", "https://c.test");
  assert.equal(other.status, 1);
  assert.match(other.stderr, /PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS is for this package's tests, naming a directory of fake commands/);
  oneLine(other);
  const outside = { ...env };
  delete outside.NODE_TEST_CONTEXT;
  const dry = run(outside, "status");
  assert.equal(dry.status, 1);
  assert.equal(dry.stderr.trim(), "PHARO_AGENT_TELEMETRY_DRY_RUN is for this package's tests only.");
}));

test("join refuses an --endpoint that is no collector's, says when no --token is given, and an unknown command is named", () => withHome(({ cli, agent }) => {
  const refused = cli("join", "--endpoint", "not-a-url");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--endpoint: not-a-url is not a URL\./);
  assert.equal(fs.existsSync(agent), false);
  const joined = cli("join", "--endpoint", "https://c.test");
  assert.equal(joined.status, 0, joined.stderr);
  assert.match(joined.stdout, /No --token given: a collector that requires one/);
  assert.doesNotMatch(cli("join", "--endpoint", "https://c.test", "--token", "t").stdout, /No --token given/);
  assert.match(cli("bogus").stderr, /^Unknown command bogus\./);
}));
