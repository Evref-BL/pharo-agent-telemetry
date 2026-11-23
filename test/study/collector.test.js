// The collector as deployed, in Docker: the rule fixtures go in through
// Caddy and the archive must hold exactly what each expects, as the agent's
// filter does; a span carrying everything forbidden leaves none of it.
// Skipped where Docker is not running.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { fetchCatalog, verifyCatalog } from "../../src/agent.js";
import { audit } from "../../src/audit.js";
import { catalogPayload, publicKeyOf, signCatalog } from "../../src/catalog.js";
import { checkDeployment } from "../../src/check.js";
import { freePort } from "../../src/install.js";
import { studyPath } from "../../src/study.js";
import { allowlist, comparable, expectedSpans, hashedTrace, ruleFixtures, study, testKey } from "../support.js";

const composeFile = path.join(studyPath(study, "collector"), "compose.yaml");
const forbidden = fs.readFileSync(new URL("../fixtures/forbidden.json", import.meta.url), "utf8");
const token = "test-token";
const project = `pat-collector-test-${process.pid}`;
// Docker, and its Compose plugin, which the collector runs with.
const dockerRuns = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0 && spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;

/** @type {string} */
let archive;
/** Where the signed catalog is, which Caddy serves, and the throwaway key it is signed with. */
/** @type {string} */
let published;
const catalogKey = /** @type {string} */ (generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
/** @type {string} */
let endpoint;
/** @type {Record<string, string>} */
let env;

const compose = (...args) => execFileSync("docker", ["compose", "-p", project, "-f", composeFile, ...args], {
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, ...env },
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
});

before(async () => {
  if (!dockerRuns) return;
  archive = fs.mkdtempSync(path.join(os.tmpdir(), "pat-archive-"));
  fs.chmodSync(archive, 0o777);
  published = fs.mkdtempSync(path.join(os.tmpdir(), "pat-published-"));
  fs.chmodSync(published, 0o755);
  fs.writeFileSync(path.join(published, "catalog.json"), signCatalog(catalogPayload(allowlist, new Date().toISOString()), catalogKey), { mode: 0o644 });
  const port = await freePort();
  endpoint = `http://127.0.0.1:${port}`;
  env = {
    SITE_ADDRESS: "http://:80",
    COLLECTOR_TOKEN: token,
    ID_HASH_KEY: testKey,
    ARCHIVE_DIR: archive,
    PUBLISHED_DIR: published,
    HTTP_PORT: `127.0.0.1:${port}`,
    HTTPS_PORT: `127.0.0.1:${await freePort()}`,
    ARCHIVE_MAX_MB: "1000",
    GUARD_INTERVAL: "1",
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
    fs.rmSync(published, { recursive: true, force: true });
  }
}, { timeout: 120_000 });

/** @param {Record<string, string>} headers */
const send = (body, headers, url = `${endpoint}/v1/traces`) => fetch(url, {
  method: "POST",
  body,
  headers: { "content-type": "application/json", ...headers },
});

/** The archive's lines, from every daily file. */
function archiveLines() {
  return fs.readdirSync(archive).filter((name) => /^traces-.*\.jsonl$/.test(name)).sort()
    .flatMap((name) => fs.readFileSync(path.join(archive, name), "utf8").split("\n").filter(Boolean));
}

/** The archived requests, once `done` says they hold what is awaited. */
async function archived(done) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const requests = archiveLines().map((line) => JSON.parse(line));
    if (done(requests)) return requests;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the archive never received the spans");
}

test("a request without the token is refused and archives nothing", { skip: !dockerRuns }, async () => {
  assert.equal((await send(forbidden, {})).status, 401);
  assert.equal((await send(forbidden, { authorization: "Bearer wrong" })).status, 401);
});

test("check-deployment finds everything a participant relies on", { skip: !dockerRuns }, async () => {
  const results = await checkDeployment(endpoint, token, fetch, { publicKey: publicKeyOf(catalogKey), allowlist, sets: catalogPayload(allowlist, "").sets });
  assert.deepEqual(results.filter((result) => !result.held), []);
  assert.equal(results.length, 8);
  // Where the agents ask for it, should catalogUrl name another path.
  const elsewhere = await checkDeployment(endpoint, token, fetch, { publicKey: publicKeyOf(catalogKey), url: `${endpoint}/pharo-agent-telemetry/other.json` });
  assert.deepEqual(elsewhere.filter((result) => !result.held).map((result) => result.saw), ["HTTP 404"]);
  // Signed by another key, the catalog is said not to be the study's.
  const other = await checkDeployment(endpoint, token, fetch, { publicKey: publicKeyOf(/** @type {string} */ (generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }))) });
  assert.deepEqual(other.filter((result) => !result.held).map((result) => result.saw), ["its signature does not hold"]);
});

test("only /v1/traces is served, and the signed catalog the agents ask for", { skip: !dockerRuns }, async () => {
  assert.equal((await send(forbidden, { authorization: `Bearer ${token}` }, `${endpoint}/v1/logs`)).status, 404);
  assert.equal((await fetch(`${endpoint}/`)).status, 404);
  const fetched = await fetchCatalog(`${endpoint}/pharo-agent-telemetry/catalog.json`);
  assert.ok("text" in fetched, JSON.stringify(fetched));
  const verified = verifyCatalog(fetched.text, publicKeyOf(catalogKey));
  assert.ok("payload" in verified, JSON.stringify(verified));
  assert.deepEqual(verified.payload.sets, catalogPayload(allowlist, "").sets);
  assert.equal((await send("{}", {}, `${endpoint}/pharo-agent-telemetry/catalog.json`)).status, 404);
  assert.equal((await fetch(`${endpoint}/pharo-agent-telemetry/other.json`)).status, 404);
});

test("the collector keeps of each rule fixture exactly what the agent's filter keeps", { skip: !dockerRuns, timeout: 120_000 }, async () => {
  const fixtures = ruleFixtures();
  for (const fixture of fixtures) {
    assert.equal((await send(JSON.stringify(fixture.request), { authorization: `Bearer ${token}` })).status, 200, fixture.name);
  }
  const traces = (fixture) => new Set(expectedSpans(fixture).map((span) => span.trace));
  const total = fixtures.reduce((sum, fixture) => sum + fixture.expected.length, 0);
  const ours = (requests) => comparable(requests).filter((span) => fixtures.some((fixture) => traces(fixture).has(span.trace)));
  await archived((requests) => ours(requests).length >= total);
  // Whatever the batch still held has reached the file by now.
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const spans = ours(await archived(() => true));
  for (const fixture of fixtures) {
    assert.deepEqual(spans.filter((span) => traces(fixture).has(span.trace)), expectedSpans(fixture), `${fixture.name}: ${fixture.about}`);
  }
  for (const line of archiveLines()) {
    for (const resourceSpans of JSON.parse(line).resourceSpans) {
      assert.match(resourceSpans.resource.attributes.find(({ key }) => key === "fileexporter.path_segment").value.stringValue, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test("nothing forbidden reaches the archive, and audit finds nothing in it", { skip: !dockerRuns }, async () => {
  assert.equal((await send(forbidden, { authorization: `Bearer ${token}` })).status, 200);
  const sent = JSON.parse(forbidden).resourceSpans.flatMap((each) => each.scopeSpans.flatMap((scoped) => scoped.spans));
  const kept = new Set(sent.map((span) => hashedTrace(span.traceId, span.startTimeUnixNano, span.attributes?.find(({ key }) => key === "session.id")?.value.stringValue)));
  await archived((requests) => comparable(requests).some((span) => kept.has(span.trace)));
  const raw = archiveLines().join("\n");
  for (const secret of ["adas-laptop", "/Users/ada", "ada@example.org", "Secret", "4242", "127.0.0.1", "10.0.0.7", "fe80", "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", "4b1d3a1e", "1763630000"]) {
    assert.equal(raw.includes(secret), false, `${secret} reached the archive`);
  }
  const ours = JSON.stringify(comparable(archiveLines().map((line) => JSON.parse(line))).filter((span) => kept.has(span.trace)));
  for (const secret of ["acme", "Acme", "AAAA", "built by"]) assert.equal(ours.includes(secret), false, `${secret} reached the archive: ${ours}`);
  assert.deepEqual(audit(archiveLines(), allowlist).problems, []);
});

/** One component's span of a call in a session, sent on its own as that component would. */
const componentSpan = (service, traceId, spanId) => JSON.stringify({
  resourceSpans: [{
    resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
    scopeSpans: [{ scope: { name: service === "plexus" ? "@evref-bl/plexus" : "mcp-pharo" }, spans: [{
      traceId,
      spanId,
      name: "tools/call class_get",
      kind: 2,
      startTimeUnixNano: "1763630000000000000",
      endTimeUnixNano: "1763630000250000000",
      attributes: [{ key: "session.id", value: { stringValue: "sampled" } }],
    }] }],
  }],
});

test("sampling keeps or drops all of a call's spans together", { skip: !dockerRuns, timeout: 180_000 }, async () => {
  env = { ...env, SAMPLING_PERCENTAGE: "50" };
  compose("up", "-d", "--wait", "otelcol");
  const traces = Array.from({ length: 60 }, (_, index) => `5a${index.toString(16).padStart(2, "0")}${"0".repeat(26)}${index.toString(16).padStart(2, "0")}`);
  for (const traceId of traces) {
    for (const [service, spanId] of [["plexus", "b000000000000001"], ["pharo-mcp", "b000000000000002"]]) {
      for (let attempt = 0; ; attempt += 1) {
        const response = await send(componentSpan(service, traceId, spanId), { authorization: `Bearer ${token}` }).catch(() => undefined);
        if (response?.status === 200) break;
        if (attempt > 40) throw new Error(`the collector refused a span: ${response?.status}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  // The batch processor holds spans up to five seconds before the file has them.
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const hashed = new Set(traces.map((traceId) => hashedTrace(traceId, "1763630000000000000", "sampled")));
  const sampled = comparable(await archived(() => true)).filter((span) => hashed.has(span.trace));
  const perTrace = Object.groupBy(sampled, (span) => span.trace);
  const kept = Object.keys(perTrace).length;
  assert.ok(kept > 10 && kept < 50, `kept ${kept} of 60 traces`);
  for (const [traceId, spans] of Object.entries(perTrace)) {
    assert.deepEqual(spans.map((span) => span.resource["service.name"]).sort(), ["pharo-mcp", "plexus"], traceId);
  }
});

test("past its cap the archive refuses new spans rather than lose any", { skip: !dockerRuns, timeout: 60_000 }, async () => {
  const before = archiveLines().length;
  env = { ...env, ARCHIVE_MAX_MB: "0" };
  compose("up", "-d", "--wait", "guard");
  let status;
  for (let attempt = 0; attempt < 20 && status !== 507; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = (await send(componentSpan("plexus", "5b000000000000000000000000000001", "b000000000000003"), { authorization: `Bearer ${token}` })).status;
  }
  assert.equal(status, 507);
  assert.ok(archiveLines().length >= before, "nothing was deleted");
  env = { ...env, ARCHIVE_MAX_MB: "1000" };
  compose("up", "-d", "--wait", "guard");
});

test("a request the proxy cannot pass on leaves no client address in its log", { skip: !dockerRuns, timeout: 60_000 }, async () => {
  // Last, since it stops the collector: Caddy logs a failed upstream with the
  // request, its address included, unless told not to.
  compose("stop", "otelcol");
  let response;
  for (let attempt = 0; attempt < 20 && response?.status !== 502; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    response = await send(forbidden, { authorization: `Bearer ${token}` });
  }
  assert.equal(response?.status, 502);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const logs = compose("logs", "caddy");
  assert.equal(/remote_ip|client_ip|remote_addr/.test(logs), false, logs);
});
