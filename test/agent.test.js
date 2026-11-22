// The agent: what it takes, what it answers, what it keeps and how it sends
// it. The last test runs the agent as its service does, from the files join
// copies, against a collector of the test's own.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { backoff, bodyCap, createForwarder, queueCap, startAgent } from "../src/agent.js";
import { freePort, installAgent } from "../src/install.js";
import { filter } from "../src/telemetry-transform.mjs";
import { comparable, expectedSpans, ruleFixtures, testKey } from "./support.js";

const [fixture] = ruleFixtures().filter(({ name }) => name === "kept-and-dropped");
const body = JSON.stringify(fixture.request);

/** An agent with the real filter, whose kept requests are collected. */
async function withAgent(run, transform = filter(testKey)) {
  const kept = [];
  const stop = new AbortController();
  const { port, closed } = await startAgent({ port: 0, transform, keep: (request, signal) => kept.push({ request, signal }), signal: stop.signal });
  try {
    return await run({ url: `http://127.0.0.1:${port}`, port, kept });
  } finally {
    stop.abort();
    await closed;
  }
}

const post = (url, data, headers = {}) => fetch(url, { method: "POST", body: data, headers: { "content-type": "application/json", ...headers } });

/** Waits until `done` holds, or a second has passed. */
async function eventually(done) {
  for (let attempt = 0; attempt < 100 && !done(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

/** A request with headers only, answered before any body is sent. */
function headersOnly(port, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/traces", headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.flushHeaders();
  });
}

test("keeps of a request what the filter keeps, and only that", () => withAgent(async ({ url, kept }) => {
  const response = await post(`${url}/v1/traces`, body);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "{}");
  await eventually(() => kept.length === 1);
  assert.equal(kept[0].signal, "traces");
  assert.deepEqual(comparable([kept[0].request]), expectedSpans(fixture));
}));

test("takes a gzipped request as the tools may send it", () => withAgent(async ({ url, kept }) => {
  assert.equal((await post(`${url}/v1/traces`, zlib.gzipSync(body), { "content-encoding": "gzip" })).status, 200);
  await eventually(() => kept.length === 1);
  assert.deepEqual(comparable([kept[0].request]), expectedSpans(fixture));
}));

test("answers before it filters, so a tool never waits on it", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await withAgent(async ({ url, kept }) => {
    const response = await post(`${url}/v1/traces`, body);
    assert.equal(response.status, 200);
    assert.equal(kept.length, 0);
    release();
    await eventually(() => kept.length === 1);
    assert.equal(kept.length, 1);
  }, async (signal, request) => {
    await held;
    return filter(testKey)(signal, request);
  });
});

test("metrics, logs and malformed requests are answered and dropped", () => withAgent(async ({ url, kept }) => {
  assert.equal((await post(`${url}/v1/metrics`, body)).status, 200);
  assert.equal((await post(`${url}/v1/logs`, body)).status, 200);
  assert.equal((await post(`${url}/v1/traces`, "{not json")).status, 200);
  assert.equal((await post(`${url}/v1/traces`, Buffer.from([0x1f, 0x8b, 1, 2]), { "content-encoding": "gzip" })).status, 200);
  assert.equal((await post(`${url}/v1/traces`, body)).status, 200);
  await eventually(() => kept.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(kept.length, 1);
}));

test("refuses what the tools never send: another path or method, a browser page, another type, a body past the cap", () => withAgent(async ({ url, port, kept }) => {
  assert.equal((await post(`${url}/v1/other`, body)).status, 404);
  assert.equal((await fetch(`${url}/v1/traces`)).status, 404);
  assert.equal((await post(`${url}/v1/traces`, body, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(`${url}/v1/traces`, body, { "content-type": "application/x-protobuf" })).status, 415);
  assert.equal(await headersOnly(port, { "content-type": "application/json", "content-length": String(bodyCap + 1) }), 413);
  // A body past the cap without its length: refused as it comes, or cut off.
  const status = await post(`${url}/v1/traces`, new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.alloc(bodyCap + 1024, 0x20));
      controller.close();
    },
  }), { duplex: "half" }).then((response) => response.status, () => "cut off");
  assert.ok(status === 413 || status === "cut off", String(status));
  assert.equal(kept.length, 0);
  // It still serves the tools afterwards.
  assert.equal((await post(`${url}/v1/traces`, body)).status, 200);
  await eventually(() => kept.length === 1);
  assert.equal(kept.length, 1);
}));

test("sends in order, and after a failure stops for a while, longer each time up to an hour", async () => {
  let clock = 0;
  const outcomes = [true, false, true, false, false];
  const sent = [];
  const forwarder = createForwarder({ endpoint: "https://c.test", now: () => clock, send: async (each) => { sent.push(each); return outcomes.shift() ?? true; } });
  assert.equal(forwarder.enqueue("a"), true);
  assert.equal(forwarder.enqueue("b"), true);
  await forwarder.idle();
  assert.deepEqual(sent, ["a", "b"]);
  assert.equal(forwarder.closedUntil, backoff.first);
  assert.equal(forwarder.enqueue("dropped"), false);
  clock = backoff.first;
  forwarder.enqueue("c");
  await forwarder.idle();
  clock += 1;
  forwarder.enqueue("d");
  await forwarder.idle();
  assert.equal(forwarder.closedUntil, clock + backoff.first);
  clock = forwarder.closedUntil;
  forwarder.enqueue("e");
  await forwarder.idle();
  assert.equal(forwarder.closedUntil, clock + 2 * backoff.first);
  assert.deepEqual(sent, ["a", "b", "c", "d", "e"]);
  assert.deepEqual({ ...forwarder.counts }, { sent: 2, failed: 3, dropped: 1 });

  const failing = createForwarder({ endpoint: "https://c.test", now: () => clock, send: async () => false });
  for (let failure = 0; failure < 12; failure += 1) {
    clock = failing.closedUntil;
    failing.enqueue("x");
    await failing.idle();
  }
  assert.equal(failing.closedUntil - clock, backoff.last);
});

test("past its bound the queue drops what comes, by count and by size", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const forwarder = createForwarder({ endpoint: "https://c.test", send: async () => { await held; return true; } });
  assert.equal(forwarder.enqueue("in flight"), true);
  for (let index = 0; index < queueCap.requests; index += 1) assert.equal(forwarder.enqueue("x"), true);
  assert.equal(forwarder.enqueue("one too many"), false);
  release();
  await forwarder.idle();
  assert.equal(forwarder.counts.sent, queueCap.requests + 1);
  assert.equal(forwarder.enqueue("x".repeat(queueCap.bytes + 1)), false);
  assert.equal(forwarder.counts.dropped, 2);
});

/** A collector of the test's own, recording what reaches it. */
async function withCollector(run, answer = (request, response) => response.writeHead(200).end("{}")) {
  const received = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      answer(request, response);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    return await run({ endpoint: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`, received });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

test("sends to the collector's /v1/traces with the token, and follows no redirect", () => withCollector(async ({ endpoint, received }) => {
  const forwarder = createForwarder({ endpoint: `${endpoint}/`, token: "t0ken" });
  forwarder.enqueue('{"resourceSpans":[]}');
  await forwarder.idle();
  assert.deepEqual(received.map(({ url, headers, body: text }) => [url, headers.authorization, headers["content-type"], text]), [["/v1/traces", "Bearer t0ken", "application/json", '{"resourceSpans":[]}']]);
  assert.equal(forwarder.counts.sent, 1);
}).then(() => withCollector(async ({ endpoint, received }) => {
  const forwarder = createForwarder({ endpoint, token: "t0ken" });
  forwarder.enqueue("{}");
  await forwarder.idle();
  assert.deepEqual(received.map(({ url }) => url), ["/v1/traces"]);
  assert.equal(forwarder.counts.failed, 1);
}, (request, response) => response.writeHead(307, { location: "/elsewhere" }).end())));

test("run from the files join copies, the agent sends what it keeps to the collector, and stops on a signal", () => withCollector(async ({ endpoint, received }) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-agent-"));
  try {
    const port = await freePort();
    installAgent(directory, { port, endpoint, token: "t0ken" });
    fs.writeFileSync(path.join(directory, "telemetry-transform.key"), `${testKey}\n`);
    const child = spawn(process.execPath, [path.join(directory, "agent.mjs")], { stdio: "ignore" });
    const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    let status;
    for (let attempt = 0; attempt < 100 && status !== 200; attempt += 1) {
      status = await post(`http://127.0.0.1:${port}/v1/traces`, body).then((response) => response.status, () => undefined);
      if (status !== 200) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(status, 200);
    await eventually(() => received.length === 1);
    child.kill("SIGTERM");
    assert.equal(await exited, 0);
    assert.equal(received.length, 1);
    assert.equal(received[0].headers.authorization, "Bearer t0ken");
    assert.deepEqual(comparable([JSON.parse(received[0].body)]), expectedSpans(fixture));
    assert.equal(received[0].body.includes("4bf92f3577b34da6a3ce929d0e0e4736"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}));
