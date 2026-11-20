// The collector as deployed, in Docker: a span carrying everything the
// allowlist forbids goes in through Caddy, and the archive must hold none of
// it. Skipped where Docker is not running.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { longestValue } from "../src/generate.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const composeFile = path.join(root, "collector", "compose.yaml");
const fixture = fs.readFileSync(new URL("./fixtures/forbidden.json", import.meta.url), "utf8");
const token = "test-token";
const project = `pat-collector-test-${process.pid}`;
const dockerRuns = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

/** A localhost port nothing listens on. */
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return port;
}

/** @type {string} */
let archive;
/** @type {string} */
let endpoint;
/** @type {Record<string, string>} */
let env;

const compose = (...args) => execFileSync("docker", ["compose", "-p", project, "-f", composeFile, ...args], {
  env: { ...process.env, ...env },
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
});

before(async () => {
  if (!dockerRuns) return;
  archive = fs.mkdtempSync(path.join(os.tmpdir(), "pat-archive-"));
  fs.chmodSync(archive, 0o777);
  const port = await freePort();
  endpoint = `http://127.0.0.1:${port}`;
  env = {
    SITE_ADDRESS: "http://:80",
    COLLECTOR_TOKEN: token,
    ARCHIVE_DIR: archive,
    HTTP_PORT: `127.0.0.1:${port}`,
    HTTPS_PORT: `127.0.0.1:${await freePort()}`,
  };
  compose("up", "-d", "--wait");
  // Caddy answers before the collector is listening behind it.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${endpoint}/v1/traces`, { method: "POST", body: "{}", headers: { "content-type": "application/json", authorization: `Bearer ${token}` } }).catch(() => undefined);
    if (response && response.status !== 502) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}, { timeout: 180_000 });

after(() => {
  if (!dockerRuns) return;
  try {
    compose("down", "-v");
  } finally {
    fs.rmSync(archive, { recursive: true, force: true });
  }
}, { timeout: 120_000 });

/** @param {Record<string, string>} headers */
const send = (headers, url = `${endpoint}/v1/traces`) => fetch(url, {
  method: "POST",
  body: fixture,
  headers: { "content-type": "application/json", ...headers },
});

/** The spans the archive holds, once it holds `count` of them. */
async function archivedSpans(count) {
  const file = path.join(archive, "traces.jsonl");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (fs.existsSync(file)) {
      const spans = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) =>
        JSON.parse(line).resourceSpans.flatMap((resourceSpans) =>
          resourceSpans.scopeSpans.flatMap((scopeSpans) =>
            scopeSpans.spans.map((span) => ({ resource: resourceSpans.resource, scope: scopeSpans.scope, span })))));
      if (spans.length >= count) return spans;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the archive never received the spans");
}

const attributes = (list = []) => Object.fromEntries(list.map(({ key, value }) => [key, value]));

test("a request without the token is refused and archives nothing", { skip: !dockerRuns }, async () => {
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ authorization: "Bearer wrong" })).status, 401);
});

test("only /v1/traces is served", { skip: !dockerRuns }, async () => {
  assert.equal((await send({ authorization: `Bearer ${token}` }, `${endpoint}/v1/logs`)).status, 404);
  assert.equal((await fetch(`${endpoint}/`)).status, 404);
});

test("the archive keeps what the allowlist allows, and nothing else", { skip: !dockerRuns }, async () => {
  assert.equal((await send({ authorization: `Bearer ${token}` })).status, 200);
  const spans = await archivedSpans(2);
  const raw = JSON.stringify(spans);
  for (const secret of ["adas-laptop", "/Users/ada", "ada@example.org", "Secret", "4242", "127.0.0.1", "10.0.0.7"]) {
    assert.equal(raw.includes(secret), false, `${secret} reached the archive: ${raw}`);
  }

  const call = spans.find(({ span }) => span.spanId === "00f067aa0ba902b7");
  assert.ok(call);
  assert.deepEqual(Object.keys(attributes(call.resource.attributes)).sort(), ["service.name", "service.version"]);
  assert.deepEqual(call.scope.attributes ?? [], []);
  assert.deepEqual(Object.keys(attributes(call.span.attributes)).sort(), [
    "error.type",
    "gen_ai.tool.name",
    "pharo.mcp.input.bytes",
    "pharo_agent.argument.names",
    "pharo_agent.client.name",
    "pharo_agent.client.version",
  ]);
  assert.equal(call.span.name, "tools/call class_get");
  assert.equal(call.span.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.deepEqual(call.span.events ?? [], []);
  assert.equal(call.span.status.code, 2);
  assert.equal(call.span.status.message ?? "", "");

  const child = spans.find(({ span }) => span.spanId === "00f067aa0ba902b8");
  assert.ok(child);
  assert.equal(child.span.name, "_OTHER");
  assert.equal(child.span.parentSpanId, "00f067aa0ba902b7");
  const kept = attributes(child.span.attributes);
  assert.equal(kept["session.id"].stringValue, "4b1d3a1e-0000-4000-8000-000000000000");
  assert.equal(kept["gen_ai.tool.name"].stringValue.length, longestValue);
});
