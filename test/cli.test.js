import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeRequest, startPreview } from "../src/preview.js";
import { readSettings, settingsFile } from "../src/settings.js";
import { missingForJoin } from "../src/collector.js";
import { participantsPage } from "../src/generate.js";

const binary = new URL("../bin/pharo-agent-telemetry.js", import.meta.url).pathname;
const allowlist = JSON.parse(fs.readFileSync(new URL("../collector/allowlist.json", import.meta.url), "utf8"));
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/forbidden.json", import.meta.url), "utf8"));

async function withConfigHome(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pat-config-"));
  try {
    return await run(home, path.join(home, "plexus", "otel.env"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const cli = (home, ...args) => spawnSync(process.execPath, [binary, ...args], {
  env: { ...process.env, XDG_CONFIG_HOME: home },
  encoding: "utf8",
});

test("the settings file is where the tools look", () => {
  assert.equal(settingsFile({ XDG_CONFIG_HOME: "/c" }, "linux", "/home/a"), "/c/plexus/otel.env");
  assert.equal(settingsFile({}, "darwin", "/Users/a"), "/Users/a/.config/plexus/otel.env");
  assert.equal(settingsFile({ APPDATA: "C:\\Users\\A\\AppData\\Roaming" }, "win32", "C:\\Users\\A"), "C:\\Users\\A\\AppData\\Roaming\\plexus\\otel.env");
});

test("join writes traces-only settings with the token as a header, and leave deletes them", () => withConfigHome((home, file) => {
  const joined = cli(home, "join", "--endpoint", "https://c.test/", "--token", "t k");
  assert.equal(joined.status, 0, joined.stderr);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^OTEL_EXPORTER_OTLP_ENDPOINT=https:\/\/c\.test$/m);
  assert.match(text, /^OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20t%20k$/m);
  assert.match(text, /^OTEL_TRACES_EXPORTER=otlp$/m);
  assert.match(text, /^OTEL_BSP_SCHEDULE_DELAY=1000$/m);
  assert.match(text, /^OTEL_METRICS_EXPORTER=none$/m);
  assert.match(text, /^OTEL_LOGS_EXPORTER=none$/m);
  assert.match(text, /^OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=field$/m);
  assert.equal(readSettings(file)?.writer, "joined");
  assert.match(cli(home, "status").stdout, /^Joined\./);
  assert.equal(cli(home, "leave").status, 0);
  assert.equal(fs.existsSync(file), false);
  assert.match(cli(home, "status").stdout, /^Not joined\./);
}));

test("join refuses before the collector exists, and never replaces settings it did not write unless forced", () => withConfigHome((home, file) => {
  assert.match(cli(home, "join").stderr, /its endpoint, token, controller, host are not set yet/);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "OTEL_EXPORTER_OTLP_ENDPOINT=http://mine\n");
  const refused = cli(home, "join", "--endpoint", "https://c.test");
  assert.equal(refused.status, 1);
  assert.equal(fs.readFileSync(file, "utf8"), "OTEL_EXPORTER_OTLP_ENDPOINT=http://mine\n");
  assert.equal(cli(home, "leave").status, 1);
  assert.equal(cli(home, "join", "--endpoint", "https://c.test", "--force").status, 0);
  assert.equal(readSettings(file)?.writer, "joined");
}));

test("a preview prints each span, marks what the collector drops, and puts the settings back", () => withConfigHome(async (home, file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "# Written by pharo-agent-telemetry (joined).\nOTEL_EXPORTER_OTLP_ENDPOINT=https://c.test\n");
  const before = fs.readFileSync(file, "utf8");
  const printed = [];
  const stop = new AbortController();
  const { port, done } = await startPreview({ file, allowlist, print: (line) => printed.push(line), signal: stop.signal });
  assert.equal(readSettings(file)?.writer, "preview");
  assert.match(fs.readFileSync(file, "utf8"), new RegExp(`^OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${port}$`, "m"));
  assert.match(fs.readFileSync(file, "utf8"), /^OTEL_EXPORTER_OTLP_PROTOCOL=http\/json$/m);
  const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, { method: "POST", body: JSON.stringify(fixture), headers: { "content-type": "application/json" } });
  assert.equal(response.status, 200);
  stop.abort();
  await done;
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.ok(printed.includes("tools/call class_get (250.0 ms, failed)"), printed.join("\n"));
  assert.ok(printed.some((line) => line.includes('host.name = "adas-laptop"   (dropped by the collector)')));
  assert.ok(printed.some((line) => line.includes('gen_ai.tool.name = "class_get"') && !line.includes("dropped")));
}));

test("a span is described with its duration, attributes and resource", () => {
  const lines = describeRequest(fixture, allowlist);
  assert.ok(lines.includes("    1 event(s)   (dropped by the collector)"));
  assert.ok(lines.includes('    plexus.argument.names = ["name"]'));
});

test("the page names who answers for the data and where it is once they are set, and says so while they are not", () => {
  const unset = participantsPage(allowlist, {});
  assert.match(unset, /The controller and how to reach them: not set yet/);
  assert.match(unset, /Where the collector runs: not set yet/);
  const set = participantsPage(allowlist, {
    endpoint: "https://c.test",
    token: "t",
    controller: { name: "Example SA", contact: "privacy@example.test" },
    host: { provider: "Example Cloud", region: "Paris", archive: "Example's Elasticsearch, in France" },
  });
  assert.doesNotMatch(set, /not set yet/);
  assert.match(set, /Example SA decides why and how/);
  assert.match(set, /privacy@example\.test/);
  assert.match(set, /at Example Cloud, in Paris/);
  assert.match(set, /to Example's Elasticsearch, in France/);
  assert.match(set, /consent/);
  assert.match(set, /CNIL/);
});

test("join refuses the project's collector while anything about it is missing", () => {
  assert.deepEqual(missingForJoin({}), ["endpoint", "token", "controller", "host"]);
  assert.deepEqual(missingForJoin({ endpoint: "https://c.test", token: "t", controller: { name: "n", contact: "c" }, host: { provider: "p", region: "r", archive: "a" } }), []);
});
