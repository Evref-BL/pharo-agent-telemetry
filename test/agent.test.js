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
import { generateKeyPairSync } from "node:crypto";
import {
  acceptCatalog, backoff, bodyCap, catalogCap, createForwarder, fetchCatalog, healthPath, identify, proof, queueCap, readSessions, runAgent, sendCap, sessionsText, signedCatalogFile,
  startAgent, stopAgent, stopPath, verifyCatalog, whoListens,
} from "../src/agent.js";
import { catalogPayload, publicKeyOf, signCatalog } from "../src/catalog.js";
import { readAllowlist } from "../src/generate.js";
import { freePort, installAgent } from "../src/install.js";
import { offsetKey } from "../src/rules.js";
import { catalog as builtIn, catalogRefusal, filter } from "../src/telemetry-transform.mjs";
import { comparable, expectedSpans, ruleFixtures, testKey } from "./support.js";

const [fixture] = ruleFixtures().filter(({ name }) => name === "kept-and-dropped");
const body = JSON.stringify(fixture.request);

/** An agent with the real filter, whose kept requests are collected. */
async function withAgent(run, transform = filter(testKey, { offsets: false })) {
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
    return filter(testKey, { offsets: false })(signal, request);
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

test("sends in order, retries a failure once on a fresh connection, then stops for a while, longer each time up to an hour", async () => {
  let clock = 0;
  // A send that fails is tried again on a fresh connection before it counts as failed.
  const outcomes = [true, false, false, true, false, false, false, false];
  const sent = [];
  const forwarder = createForwarder({ endpoint: "https://c.test", now: () => clock, send: async (each, { fresh }) => { sent.push(fresh ? `${each} again` : each); return outcomes.shift() ?? true; } });
  assert.equal(forwarder.enqueue("a"), true);
  await forwarder.idle();
  assert.equal(forwarder.enqueue("b"), true);
  await forwarder.idle();
  assert.deepEqual(sent, ["a", "b", "b again"]);
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
  assert.deepEqual(sent, ["a", "b", "b again", "c", "d", "d again", "e", "e again"]);
  assert.deepEqual({ ...forwarder.counts }, { sent: 2, failed: 3, dropped: 1, refused: 0 });
  assert.equal(forwarder.last.outcome, "failed");

  const failing = createForwarder({ endpoint: "https://c.test", now: () => clock, send: async () => false });
  for (let failure = 0; failure < 12; failure += 1) {
    clock = failing.closedUntil;
    failing.enqueue("x");
    await failing.idle();
  }
  assert.equal(failing.closedUntil - clock, backoff.last);
});

test("a request the collector refuses is not retried and stops nothing; one that fails then passes on a fresh connection is sent", async () => {
  const outcomes = ["refused", false, true];
  const sent = [];
  const forwarder = createForwarder({ endpoint: "https://c.test", send: async (each, { fresh }) => { sent.push([each, fresh]); return outcomes.shift() ?? true; } });
  forwarder.enqueue("refused");
  await forwarder.idle();
  forwarder.enqueue("reset");
  await forwarder.idle();
  assert.deepEqual(sent, [["refused", false], ["reset", false], ["reset", true]]);
  assert.deepEqual({ ...forwarder.counts }, { sent: 1, failed: 0, dropped: 0, refused: 1 });
  assert.equal(forwarder.closedUntil, 0);
});

test("the requests waiting are sent merged in one, under the collector's limit", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const forwarder = createForwarder({ endpoint: "https://c.test", send: async (each) => { sent.push(each); await held; return true; } });
  const request = (name) => JSON.stringify({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name }, spans: [] }] }] });
  forwarder.enqueue(request("first"));
  for (const name of ["a", "b", "c"]) forwarder.enqueue(request(name));
  // Too large to merge with what waits, under the limit on its own.
  const large = JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: "k", value: { stringValue: "x".repeat(sendCap - 200) } }] }, scopeSpans: [] }] });
  forwarder.enqueue(large);
  release();
  await forwarder.idle();
  assert.equal(sent.length, 3);
  assert.equal(sent[0], request("first"));
  assert.deepEqual(JSON.parse(sent[1]).resourceSpans.map((each) => each.scopeSpans[0].scope.name), ["a", "b", "c"]);
  assert.equal(sent[2], large);
  assert.equal(forwarder.counts.sent, 5);
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
  // Tried again on a fresh connection, never at the redirect's location.
  assert.deepEqual(received.map(({ url }) => url), ["/v1/traces", "/v1/traces"]);
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
    assert.equal(await whoListens(port, testKey), "agent");
    // Asked to stop by whoever proves its key, it ends as on a signal.
    assert.equal(await stopAgent(port, testKey), true);
    assert.equal(await exited, 0);
    const state = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
    assert.deepEqual(Object.keys(state.received).sort(), ["pharo-mcp", "plexus"]);
    assert.equal(state.received.plexus.requests, 1);
    assert.equal(state.forwarded.sent, 1);
    assert.equal(state.forwarded.last.outcome, "sent");
    // The sessions it saw outlive it, hashed, for the next run's offsets.
    const sessions = readSessions(path.join(directory, "sessions.json"));
    assert.ok(sessions.size > 0);
    for (const session of sessions.keys()) assert.match(session, /^[0-9a-f]{32}$/);
    assert.equal(fs.statSync(path.join(directory, "sessions.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(directory, "state.json")).mode & 0o777, 0o600);
    assert.equal(received.length, 1);
    assert.equal(received[0].headers.authorization, "Bearer t0ken");
    const sent = comparable([JSON.parse(received[0].body)]);
    // The agent adds each span's place in its session, which the fixture leaves out.
    for (const span of sent.filter(({ attributes }) => attributes["session.id"] !== undefined)) {
      assert.ok(Number.isInteger(span.attributes[offsetKey]));
      delete span.attributes[offsetKey];
    }
    assert.deepEqual(sent, expectedSpans(fixture));
    assert.equal(received[0].body.includes("4bf92f3577b34da6a3ce929d0e0e4736"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}));

test("the agent proves it holds its key without giving it away, and stops only for whoever proves it too", async () => {
  const stopped = new AbortController();
  let clock = 1_000_000;
  const { port, closed } = await startAgent({ port: 0, transform: () => null, keep: () => {}, signal: stopped.signal, secret: testKey, stop: () => stopped.abort(), now: () => clock });
  try {
    assert.equal(await whoListens(port, testKey), "agent");
    assert.equal(await whoListens(port, "ff".repeat(32)), "other");
    const challenge = "ab".repeat(16);
    const answer = await (await fetch(`http://127.0.0.1:${port}${healthPath}?challenge=${challenge}`)).json();
    assert.match(answer.instance, /^[0-9a-f]{32}$/);
    assert.deepEqual(answer, { agent: "pharo-agent-telemetry", role: "agent", instance: answer.instance, proof: proof(testKey, "health", `${challenge}:${answer.instance}:agent`) });
    assert.equal(JSON.stringify(answer).includes(testKey), false);
    assert.equal((await fetch(`http://127.0.0.1:${port}${healthPath}?challenge=short`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}${healthPath}?challenge=${challenge}`, { headers: { origin: "https://evil.example" } })).status, 403);
    const { instance } = await identify(port, testKey);
    const stop = (at, secret = testKey, run = instance) => fetch(`http://127.0.0.1:${port}${stopPath}?at=${at}&instance=${run}&proof=${proof(secret, "stop", `${run}:${at}`)}`, { method: "POST" }).then((response) => response.status);
    assert.equal(await stop(clock, "ff".repeat(32)), 403);
    assert.equal(await stop(clock - 60_000), 403);
    // A proof for another run of the agent, as one handed to an earlier run, is refused.
    assert.equal(await stop(clock, testKey, "ab".repeat(16)), 403);
    assert.equal(stopped.signal.aborted, false);
    assert.equal(await stop(clock), 200);
    await closed;
    assert.equal(stopped.signal.aborted, true);
  } finally {
    stopped.abort();
    await closed;
  }
  assert.equal(await whoListens(port, testKey), "none");
});

test("a stop request is never taken twice, and without a key the agent answers neither", async () => {
  const stopped = new AbortController();
  let stops = 0;
  const clock = 1_000_000;
  const { port, closed } = await startAgent({ port: 0, transform: () => null, keep: () => {}, signal: stopped.signal, secret: testKey, stop: () => { stops += 1; }, now: () => clock });
  const { instance } = await identify(port, testKey);
  const stop = (at) => fetch(`http://127.0.0.1:${port}${stopPath}?at=${at}&instance=${instance}&proof=${proof(testKey, "stop", `${instance}:${at}`)}`, { method: "POST" }).then((response) => response.status);
  assert.equal(await stop(clock), 200);
  assert.equal(await stop(clock), 403);
  stopped.abort();
  await closed;
  assert.equal(stops, 1);
  await withAgent(async ({ port: other }) => {
    assert.equal(await whoListens(other, testKey), "other");
    assert.equal((await fetch(`http://127.0.0.1:${other}${stopPath}?at=1&proof=x`, { method: "POST" })).status, 404);
  });
});

test("a merged send the collector refuses is sent again request by request, so one refused request loses no other", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const request = (name) => JSON.stringify({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name }, spans: [] }] }] });
  const forwarder = createForwarder({ endpoint: "https://c.test", send: async (body) => {
    sent.push(body);
    if (sent.length === 1) await held;
    return body.includes('"bad"') ? "refused" : true;
  } });
  forwarder.enqueue(request("first"));
  for (const name of ["a", "bad", "c"]) forwarder.enqueue(request(name));
  release();
  await forwarder.idle();
  assert.deepEqual(sent.slice(2), [request("a"), request("bad"), request("c")]);
  assert.deepEqual({ ...forwarder.counts }, { sent: 3, failed: 0, dropped: 0, refused: 1 });
});

test("a part that fails while a refused merged send is sent again request by request stops sending a while, as any failure does", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const request = (name) => JSON.stringify({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name }, spans: [] }] }] });
  // The merged send is refused, then the collector goes down.
  const forwarder = createForwarder({ endpoint: "https://c.test", send: async (body) => {
    sent.push(body);
    if (sent.length === 1) await held;
    if (body.includes('"first"')) return true;
    return body.includes('"a"') && body.includes('"c"') ? "refused" : false;
  } });
  forwarder.enqueue(request("first"));
  for (const name of ["a", "b", "c"]) forwarder.enqueue(request(name));
  release();
  await forwarder.idle();
  // The first part failed twice (pooled, then fresh); b and c were not tried.
  assert.deepEqual(sent.slice(2), [request("a"), request("a")]);
  assert.deepEqual({ ...forwarder.counts }, { sent: 1, failed: 1, dropped: 2, refused: 0 });
  assert.ok(forwarder.closedUntil > Date.now());
  assert.equal(forwarder.last?.outcome, "failed");
});

test("a stop is never asked of a port where the agent does not prove its key, and a preview says it is one", async () => {
  const asked = [];
  const impostor = http.createServer((request, response) => {
    asked.push(`${request.method} ${request.url.split("?")[0]}`);
    response.writeHead(200, { "content-type": "application/json" }).end('{"agent":"pharo-agent-telemetry","proof":"x"}');
  });
  await new Promise((resolve) => impostor.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    assert.equal(await stopAgent(impostor.address().port, testKey, 1_000), false);
    assert.deepEqual(asked, [`GET ${healthPath}`]);
  } finally {
    await new Promise((resolve) => impostor.close(() => resolve(undefined)));
  }
  const stopped = new AbortController();
  const { port, closed } = await startAgent({ port: 0, transform: () => null, keep: () => {}, signal: stopped.signal, secret: testKey, role: "preview" });
  assert.equal(await whoListens(port, testKey), "preview");
  assert.equal(await stopAgent(port, testKey, 1_000), false);
  stopped.abort();
  await closed;
});

test("the sessions remembered are those of the last hour, in the order of their last span", () => {
  const now = 10_000_000;
  const sessions = new Map([["b", { first: 5n, seen: now - 10 }], ["a", { first: -7n, seen: now - 20 }], ["old", { first: 1n, seen: now - 3_600_001 }]]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-sessions-"));
  try {
    fs.writeFileSync(path.join(directory, "sessions.json"), sessionsText(sessions, now));
    assert.deepEqual([...readSessions(path.join(directory, "sessions.json"), now)], [["a", { first: -7n, seen: now - 20 }], ["b", { first: 5n, seen: now - 10 }]]);
    fs.writeFileSync(path.join(directory, "sessions.json"), "not json");
    assert.equal(readSessions(path.join(directory, "sessions.json"), now).size, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** A server of the test's own whose answer the test sets, counting the requests. */
async function withServer(run) {
  const served = { answer: (request, response) => response.writeHead(404).end(), requests: 0 };
  const server = http.createServer((request, response) => {
    served.requests += 1;
    served.answer(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    return await run({ url: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/pharo-agent-telemetry/catalog.json`, served });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

const throwawayKey = () => /** @type {string} */ (generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
const allowlist = readAllowlist(new URL("..", import.meta.url).pathname);

test("a catalog is read whole only under its cap, from its URL alone: an unreachable host, a status, a redirect or too large a body give none", () => withServer(async ({ url, served }) => {
  assert.deepEqual(await fetchCatalog(url), { failure: "HTTP 404" });
  served.answer = (request, response) => response.writeHead(302, { location: "/elsewhere" }).end();
  assert.deepEqual(await fetchCatalog(url), { failure: "HTTP 302" });
  served.answer = (request, response) => response.writeHead(200, { "content-type": "application/json" }).end('{"payload":"{}","signature":""}');
  assert.deepEqual(await fetchCatalog(url), { text: '{"payload":"{}","signature":""}' });
  // Too large, whether it says so or not.
  served.answer = (request, response) => response.writeHead(200, { "content-length": catalogCap + 1 }).end("x".repeat(catalogCap + 1));
  assert.deepEqual(await fetchCatalog(url), { failure: "too large" });
  served.answer = (request, response) => {
    response.writeHead(200);
    for (let sent = 0; sent <= catalogCap; sent += 65_536) response.write("x".repeat(65_536));
    response.end();
  };
  assert.deepEqual(await fetchCatalog(url), { failure: "too large" });
  served.answer = () => {};
  assert.deepEqual(await fetchCatalog(url, { timeout: 200 }), { failure: "unreachable" });
  assert.deepEqual(await fetchCatalog(`http://127.0.0.1:${await freePort()}/catalog.json`), { failure: "unreachable" });
  assert.deepEqual(await fetchCatalog("file:///etc/passwd"), { failure: "unreachable" });
}));

test("a catalog whose signature holds replaces the one in use only when the filter reads it, it is newer, and it is dated no later than tomorrow", () => {
  const now = Date.now();
  const newer = catalogPayload(allowlist, new Date(now - 60_000).toISOString());
  assert.deepEqual(acceptCatalog(newer, builtIn, catalogRefusal, now), { accepted: newer });
  // A clock a few hours behind still takes it.
  const ahead = catalogPayload(allowlist, new Date(now + 20 * 3_600_000).toISOString());
  assert.deepEqual(acceptCatalog(ahead, builtIn, catalogRefusal, now), { accepted: ahead });
  assert.match(acceptCatalog(catalogPayload(allowlist, "2099-01-01T00:00:00.000Z"), builtIn, catalogRefusal, now).refused, /dated 2099-01-01T00:00:00.000Z, later than tomorrow/);
  assert.match(acceptCatalog(catalogPayload(allowlist, builtIn.published), builtIn, catalogRefusal, now).refused, /not newer than the one in use/);
  assert.match(acceptCatalog(catalogPayload(allowlist, "2020-01-01T00:00:00.000Z"), builtIn, catalogRefusal, now).refused, /not newer than the one in use/);
  assert.match(acceptCatalog({ ...newer, schema: 2 }, builtIn, catalogRefusal, now).refused, /of form 2/);
  for (const published of ["+275760-09-13T00:00:00.000Z", "2027", "Nov 23 2026"]) assert.match(acceptCatalog({ ...newer, published }, builtIn, catalogRefusal, now).refused, /its date is not a UTC date/, published);
});

test("the agent asks for a newer catalog, takes one the project signed without a restart, keeps it for its next start, and refuses any other", () => withCollector(async ({ endpoint, received }) => withServer(async ({ url, served }) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pat-agent-catalog-"));
  const key = throwawayKey();
  const serve = (text) => {
    served.answer = (request, response) => response.writeHead(200, { "content-type": "application/json" }).end(text);
  };
  // A tool of MCP's own whose name has words no catalog of today has: _OTHER until a catalog names it.
  const call = (span) => JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "pharo-mcp" } }] }, scopeSpans: [{ scope: { name: "mcp-pharo" }, spans: [{
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: span, name: "tools/call zyxwv_qtool", kind: 2, startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n), endTimeUnixNano: String(BigInt(Date.now() + 5) * 1_000_000n),
    attributes: [{ key: "gen_ai.tool.name", value: { stringValue: "zyxwv_qtool" } }, { key: "pharo.mcp.tool.origin", value: { stringValue: "mcp" } }, { key: "session.id", value: { stringValue: "s" } }],
  }] }] }] });
  const names = () => received.map(({ body: text }) => JSON.parse(text).resourceSpans[0].scopeSpans[0].spans[0].name);
  const state = () => JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8"));
  const kept = () => JSON.parse(fs.readFileSync(path.join(directory, signedCatalogFile), "utf8"));
  /** @type {{ port: number, running: Promise<void> }[]} */
  const agents = [];
  const run = async (options, publicKey = publicKeyOf(key)) => {
    const port = await freePort();
    installAgent(directory, { port, endpoint, token: "t0ken", catalog: { url, publicKey } });
    fs.writeFileSync(path.join(directory, "telemetry-transform.key"), `${testKey}\n`);
    const running = runAgent(directory, options);
    agents.push({ port, running });
    for (let attempt = 0; attempt < 100 && (await whoListens(port, testKey, 200)) !== "agent"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    return { port, running };
  };
  const stop = async ({ port, running }) => {
    assert.equal(await stopAgent(port, testKey), true);
    await running;
  };
  const send = async (port, span, count) => {
    assert.equal((await post(`http://127.0.0.1:${port}/v1/traces`, call(span))).status, 200);
    await eventually(() => received.length === count);
  };
  const until = async (done) => {
    for (let attempt = 0; attempt < 50 && !done(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  };
  try {
    const first = await run({ catalogEvery: 300 });
    await eventually(() => served.requests >= 1);
    await send(first.port, "00f067aa0ba902b1", 1);
    assert.deepEqual(names(), ["tools/call _OTHER"]);
    const grown = catalogPayload(allowlist, new Date(Date.now() - 60_000).toISOString());
    const payload = { ...grown, sets: { ...grown.sets, "MCP tools": [...grown.sets["MCP tools"], "zyxwv_qtool", "Not-A-Tool"], "agent hosts": ["evil-host"] } };
    // Signed by another key, older, of another form, or dated ahead: refused, and the filter is as it was.
    for (const [text, outcome] of [
      [signCatalog(payload, throwawayKey()), "refused: its signature does not hold"],
      [signCatalog({ ...payload, published: "2020-01-01T00:00:00.000Z" }, key), `refused: it is not newer than the one in use, of ${builtIn.published}`],
      [signCatalog({ ...payload, schema: 2 }, key), "refused: it is of form 2, and this agent reads form 1"],
      [signCatalog({ ...payload, published: "2099-01-01T00:00:00.000Z" }, key), "refused: it is dated 2099-01-01T00:00:00.000Z, later than tomorrow"],
    ]) {
      serve(text);
      const asked = served.requests;
      await eventually(() => served.requests > asked + 1);
      await until(() => state().catalog?.outcome === outcome);
      assert.equal(state().catalog.outcome, outcome);
      assert.equal(kept().signed, undefined);
    }
    await send(first.port, "00f067aa0ba902b2", 2);
    assert.deepEqual(names(), ["tools/call _OTHER", "tools/call _OTHER"]);
    const signed = signCatalog(payload, key);
    serve(signed);
    await until(() => kept().signed === signed);
    await send(first.port, "00f067aa0ba902b3", 3);
    assert.deepEqual(names().at(-1), "tools/call zyxwv_qtool");
    assert.equal(fs.statSync(path.join(directory, signedCatalogFile)).mode & 0o777, 0o600);
    await stop(first);
    // It says what the catalog adds beyond the package's: the member of its shape, to a set that grows, and nothing else.
    const { checked, outcome } = state().catalog;
    assert.deepEqual(state().catalog, { published: payload.published, releases: payload.releases, from: url, added: { "MCP tools": ["zyxwv_qtool"] }, checked, outcome });
    assert.ok(["accepted", "unchanged"].includes(outcome), outcome);

    // Started again within the day, it asks for nothing, and filters with the catalog it kept from the first span on.
    let asked = served.requests;
    served.answer = (request, response) => response.writeHead(500).end();
    const second = await run({});
    await send(second.port, "00f067aa0ba902b4", 4);
    assert.deepEqual(names().at(-1), "tools/call zyxwv_qtool");
    assert.equal(served.requests, asked);
    await stop(second);

    // A catalog dated ahead that an earlier agent kept is dropped at the next start.
    fs.writeFileSync(path.join(directory, signedCatalogFile), JSON.stringify({ checked: new Date().toISOString(), signed: signCatalog({ ...payload, published: "2099-01-01T00:00:00.000Z" }, key) }));
    const third = await run({});
    await send(third.port, "00f067aa0ba902b5", 5);
    assert.deepEqual(names().at(-1), "tools/call _OTHER");
    await stop(third);

    // With a public key anyone can sign for, it asks for no catalog and takes none it kept.
    fs.writeFileSync(path.join(directory, signedCatalogFile), JSON.stringify({ signed }));
    asked = served.requests;
    const weak = await run({ catalogEvery: 300 }, Buffer.alloc(32).toString("base64url"));
    await send(weak.port, "00f067aa0ba902b6", 6);
    assert.deepEqual(names().at(-1), "tools/call _OTHER");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(served.requests, asked);
    await stop(weak);
    assert.equal(state().catalog.outcome, "none asked for: the public key is one anyone can sign for");
  } finally {
    // An agent a failed assertion left running is stopped, so the test ends.
    for (const { port, running } of agents) {
      await stopAgent(port, testKey);
      await Promise.race([running, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
})));
