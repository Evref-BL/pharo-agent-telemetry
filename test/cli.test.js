// The command as a participant runs it, in a home of its own: the service
// commands are recorded instead of run (PHARO_AGENT_TELEMETRY_DRY_RUN), so
// nothing is installed on the machine that runs the tests.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { missingForJoin } from "../src/collector.js";
import { dpoPlaceholder, participantsPage, readAllowlist } from "../src/generate.js";
import { describeRequest, recoverPreview, startPreview } from "../src/preview.js";
import { serviceDefinition } from "../src/service.js";
import { everySettingsFile, readSettings, settingsBlock, settingsFiles, agentSettings } from "../src/settings.js";
import { filter } from "../src/telemetry-transform.mjs";
import { comparable, expectedSpans, ruleFixtures, testKey } from "./support.js";

const binary = new URL("../bin/pharo-agent-telemetry.js", import.meta.url).pathname;
const root = new URL("..", import.meta.url).pathname;
const allowlist = readAllowlist(root);
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
  const cli = (...args) => spawnSync(process.execPath, [binary, ...args], { env, encoding: "utf8" });
  const settings = { plexus: path.join(config, "plexus", "otel.env"), mcp: path.join(config, "pharo-mcp", "otel.env") };
  const agent = path.join(config, "pharo-agent-telemetry");
  try {
    return await run({ home, config, env, cli, settings, agent });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const mode = (file) => fs.statSync(file).mode & 0o777;

test("each tool's settings file is where that tool reads it", () => {
  assert.deepEqual(settingsFiles({ XDG_CONFIG_HOME: "/c" }, "linux", "/home/a"), ["/c/plexus/otel.env", "/c/pharo-mcp/otel.env"]);
  assert.deepEqual(settingsFiles({ XDG_CONFIG_HOME: "relative" }, "darwin", "/Users/a"), ["/Users/a/.config/plexus/otel.env", "/Users/a/.config/pharo-mcp/otel.env"]);
  assert.deepEqual(settingsFiles({ APPDATA: "C:\\Users\\A\\AppData\\Roaming" }, "win32", "C:\\Users\\A"), ["C:\\Users\\A\\AppData\\Roaming\\plexus\\otel.env", "C:\\Users\\A\\AppData\\Roaming\\pharo-mcp\\otel.env"]);
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
  assert.equal(fs.readFileSync(path.join(agent, "telemetry-transform.mjs"), "utf8"), fs.readFileSync(new URL("../src/telemetry-transform.mjs", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8")), { port, endpoint: "https://c.test/", token: "secret-token" });
  assert.equal(mode(path.join(agent, "agent.json")), 0o600);
  const key = fs.readFileSync(path.join(agent, "telemetry-transform.key"), "utf8");
  assert.match(key, /^[0-9a-f]{64}\n$/);
  assert.equal(mode(path.join(agent, "telemetry-transform.key")), 0o600);
  const service = serviceDefinition({ home, env: { XDG_CONFIG_HOME: config }, agent: path.join(agent, "agent.mjs") });
  const definition = fs.readFileSync(service.file);
  assert.ok(definition.includes(process.execPath) || definition.includes(Buffer.from(process.execPath, "utf16le")));
  const commands = fs.readFileSync(env.PHARO_AGENT_TELEMETRY_DRY_RUN, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(commands.length >= 2, JSON.stringify(commands));

  // Joining again keeps the port, so the tools' settings stay right, and the key, so ids still group.
  assert.equal(cli("join", "--endpoint", "https://c.test/", "--token", "secret-token").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(agent, "agent.json"), "utf8")).port, port);
  assert.equal(fs.readFileSync(path.join(agent, "telemetry-transform.key"), "utf8"), key);

  const status = cli("status").stdout;
  assert.match(status, /^Joined\./);
  assert.match(status, new RegExp(`on 127\\.0\\.0\\.1:${port}, sending to https://c\\.test/; up to date with this package`));
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
  assert.match(cli("join").stderr, /its endpoint, token, controller, dpo, host are not set yet/);
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
  const block = settingsBlock("joined", agentSettings({ port: 4321 }));
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

test("status says when the agent is older than the package, has lost its key, or a tool's block is gone", () => withHome(({ cli, agent, settings }) => {
  assert.equal(cli("join", "--endpoint", "https://c.test").status, 0);
  const transform = path.join(agent, "telemetry-transform.mjs");
  fs.writeFileSync(transform, fs.readFileSync(transform, "utf8").replace(/^export const version = "[^"]+";$/m, 'export const version = "0.0.1";'));
  fs.rmSync(path.join(agent, "telemetry-transform.key"));
  fs.rmSync(settings.mcp);
  const status = cli("status").stdout;
  assert.match(status, /version 0\.0\.1, this package is [^:]+: run join again to update it/);
  assert.match(status, /its key is missing, so it sends nothing/);
  assert.ok(status.includes(`${settings.mcp}: no block of ours, so the tool that reads it sends nothing. Run join again.`), status);
}));

test("a preview prints what the agent would send, sends nothing, and puts the settings back", () => withHome(async ({ settings }) => {
  fs.mkdirSync(path.dirname(settings.plexus), { recursive: true });
  const joined = settingsBlock("joined", agentSettings({ port: 4321 }));
  fs.writeFileSync(settings.plexus, joined);
  const printed = [];
  const stop = new AbortController();
  const { port, done } = await startPreview({ files: Object.values(settings), filter, key: testKey, print: (line) => printed.push(line), signal: stop.signal });
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
  assert.match(text, /^tools\/call image_list \(week of \d{4}-\d{2}-\d{2}\) trace [0-9a-f]{32} span [0-9a-f]{16}/m);
  for (const secret of ["adas-laptop", "/Users/ada", "acme", "4bf92f3577b34da6a3ce929d0e0e4736"]) assert.equal(text.includes(secret), false, secret);
}));

for (const signal of ["SIGHUP", "SIGINT"]) {
  test(`the preview command puts the settings back on ${signal}`, () => withHome(async ({ env, settings }) => {
    fs.mkdirSync(path.dirname(settings.plexus), { recursive: true });
    fs.writeFileSync(settings.plexus, "OTEL_SERVICE_NAME=mine\n");
    const child = spawn(process.execPath, [binary, "preview"], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  const preview = settingsBlock("preview", agentSettings({ port: 4321, environment: "preview" }));
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
  assert.ok(lines.some((line) => line.startsWith(`${span.name} (week of `) && line.includes(`trace ${span.trace}`)), lines.join("\n"));
  assert.ok(lines.includes('    mcp.method.name = "tools/call"'), lines.join("\n"));
  assert.ok(lines.some((line) => /^ {4}span\.duration_ms = [0-9.]+$/.test(line)), lines.join("\n"));
  assert.ok(lines.some((line) => /^ {2}from (@evref-bl\/plexus|mcp-pharo):$/.test(line)), lines.join("\n"));
  assert.deepEqual(comparable([kept]), expectedSpans(fixture));
});

test("the page names who answers for the data, its officer and where it is once they are set, and says so while they are not", () => {
  const unset = participantsPage(allowlist, {});
  assert.match(unset, /The controller and how to reach them: not set yet/);
  assert.match(unset, /Where the collector runs, the GitLab that copies its archive, and where the archive is kept: not set yet/);
  assert.ok(unset.includes(dpoPlaceholder));
  const set = participantsPage(allowlist, {
    endpoint: "https://c.test",
    token: "t",
    controller: { name: "Example SA", contact: "privacy@example.test" },
    dpo: "dpo@example.test",
    host: { provider: "Example Cloud", region: "Paris", importer: "Example's GitLab", archive: "Example's Elasticsearch, in France" },
  });
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

test("join refuses the project's collector while anything about it is missing", () => {
  assert.deepEqual(missingForJoin({}), ["endpoint", "token", "controller", "dpo", "host"]);
  assert.deepEqual(missingForJoin({ endpoint: "https://c.test", token: "t", controller: { name: "n", contact: "c" }, dpo: "d", host: { provider: "p", region: "r", importer: "i", archive: "a" } }), []);
});
