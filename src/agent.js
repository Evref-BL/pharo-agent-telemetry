#!/usr/bin/env node
// pharo-agent-telemetry's agent: the only way the Pharo tools' telemetry
// leaves a machine that joined. The tools send OTLP/HTTP JSON to it on a
// loopback port; it answers at once, keeps of each request only what the
// filter beside it keeps (telemetry-transform.mjs, generated from the
// collector's allowlist), and sends that to the collector.
//
// `join` copies this file into the agent's own directory as agent.mjs, with
// the filter, its key and agent.json, and runs it as a per-user service, so
// it imports nothing but Node's own modules and the filter.
import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

/** The largest request taken, compressed or not, as the collector takes. */
export const bodyCap = 4 * 1024 * 1024;

/**
 * The largest request sent: the collector's proxy takes 4 000 000 bytes, and
 * what the filter keeps of a request can be larger than the request.
 */
export const sendCap = 3_900_000;

/** What waits to be sent, at most: past it, a request is dropped. */
export const queueCap = { requests: 256, bytes: 16 * 1024 * 1024 };

/** How long sending stops after a failure: doubling from the first, up to the last. */
export const backoff = { first: 60_000, last: 3_600_000 };

/** How long a send may take, connection and answer included. */
export const sendTimeout = 10_000;

const signals = { "/v1/traces": "traces", "/v1/metrics": "metrics", "/v1/logs": "logs" };

/** Where the agent answers whoever holds its key, as `status` and `preview` do. */
export const healthPath = "/pharo-agent-telemetry/health";
export const stopPath = "/pharo-agent-telemetry/stop";

/** How long a stop request's time holds. */
const stopWindow = 30_000;

/** What proves knowledge of the key without giving it away: its HMAC of a purpose and a value. */
export const proof = (secret, purpose, value) => createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");

/** The file the agent says in what it received and sent, beside its settings. */
export const stateFile = "state.json";

const loopback = (address) => /^(?:127\.|::1$|::ffff:127\.)/.test(address ?? "");

/** The text every request the filter keeps starts with, and ends with `]}`: requests merge by their resourceSpans. */
const requestStart = '{"resourceSpans":[';
const mergeable = (body) => body.startsWith(requestStart) && body.endsWith("]}");

/**
 * Sends requests to the collector from a bounded queue, as many queued
 * requests merged in one as the collector takes, and stops for a while after
 * a failure, dropping what comes meanwhile: the data is a sample, and a
 * collector that is down is not asked again and again. A send that fails is
 * tried once more on a fresh connection first, as a collector that restarted
 * leaves the pooled one dead.
 *
 * @param {{ endpoint: string, token?: string, now?: () => number, send?: (body: string, options: { fresh: boolean }) => Promise<boolean | "refused"> }} options
 */
export function createForwarder({ endpoint, token, now = Date.now, send }) {
  const target = new URL(`${endpoint.replace(/\/+$/, "")}/v1/traces`);
  const post = send ?? ((body, { fresh }) => postOnce(target, token, body, fresh));
  /** @type {{ body: string, size: number }[]} */
  const queue = [];
  let queued = 0;
  let failures = 0;
  let closedUntil = 0;
  let running = false;
  const counts = { sent: 0, dropped: 0, failed: 0, refused: 0 };
  /** @type {{ at: number, outcome: "sent" | "refused" | "failed" } | undefined} */
  let last;

  /** The queued requests the next send takes: the first, and those after it that merge with it under the cap. */
  function nextBatch() {
    const batch = [queue.shift()];
    let size = batch[0].size;
    if (mergeable(batch[0].body)) {
      while (queue.length > 0 && mergeable(queue[0].body) && size + 1 + queue[0].size - requestStart.length - 2 <= sendCap) {
        size += 1 + queue[0].size - requestStart.length - 2;
        batch.push(queue.shift());
      }
    }
    for (const each of batch) queued -= each.size;
    const body = batch.length === 1 ? batch[0].body : `${requestStart}${batch.map(({ body: each }) => each.slice(requestStart.length, -2)).join(",")}]}`;
    return { body, requests: batch.length };
  }

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const { body, requests } = nextBatch();
      if (now() < closedUntil) {
        counts.dropped += requests;
        continue;
      }
      let outcome = await post(body, { fresh: false }).catch(() => false);
      if (outcome !== true && outcome !== "refused") outcome = await post(body, { fresh: true }).catch(() => false);
      if (outcome === true) {
        failures = 0;
        counts.sent += requests;
        last = { at: now(), outcome: "sent" };
      } else if (outcome === "refused") {
        // The collector refused this request, not every request: no reason to stop sending.
        counts.refused += requests;
        last = { at: now(), outcome: "refused" };
      } else {
        failures += 1;
        counts.failed += requests;
        closedUntil = now() + Math.min(backoff.first * 2 ** (failures - 1), backoff.last);
        last = { at: now(), outcome: "failed" };
      }
    }
    running = false;
  }

  return {
    /** Queues a request body to send; false when it was dropped. */
    enqueue(body) {
      const size = Buffer.byteLength(body);
      if (now() < closedUntil || queue.length >= queueCap.requests || queued + size > queueCap.bytes) {
        counts.dropped += 1;
        return false;
      }
      queue.push({ body, size });
      queued += size;
      void drain();
      return true;
    },
    /** Resolves once the queue is empty. */
    async idle() {
      while (running || queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 10));
    },
    counts,
    get closedUntil() {
      return closedUntil;
    },
    get last() {
      return last;
    },
  };
}

/**
 * One POST to the collector: verified TLS, no redirect followed, an answer
 * within sendTimeout, on a pooled connection or, `fresh`, a new one. True
 * when the collector took it, "refused" when it refused this request alone
 * (400, 413), false otherwise.
 */
function postOnce(target, token, body, fresh = false) {
  return new Promise((resolve) => {
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(target, {
      method: "POST",
      ...(fresh ? { agent: false } : {}),
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(target.protocol === "https:" ? { rejectUnauthorized: true } : {}),
      timeout: sendTimeout,
    }, (response) => {
      response.resume();
      const status = response.statusCode ?? 0;
      response.on("end", () => resolve(status >= 200 && status < 300 ? true : status === 400 || status === 413 ? "refused" : false));
      response.on("error", () => resolve(false));
    });
    const timer = setTimeout(() => request.destroy(), sendTimeout);
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
    request.on("close", () => clearTimeout(timer));
    request.end(body);
  });
}

/**
 * A request as JSON texts of at most `cap` bytes each, its spans shared
 * among them with their resource and scope; a span too large on its own is
 * dropped.
 *
 * @param {any} request what the filter kept
 * @returns {string[]}
 */
export function split(request, cap = sendCap) {
  const text = JSON.stringify(request);
  if (Buffer.byteLength(text) <= cap) return [text];
  const spans = request.resourceSpans.flatMap((resourceSpans, r) => resourceSpans.scopeSpans.flatMap((scopeSpans, s) => scopeSpans.spans.map((span) => ({ r, s, span }))));
  if (spans.length <= 1) return [];
  const rebuild = (part) => {
    const resources = new Map();
    for (const { r, s, span } of part) {
      if (!resources.has(r)) resources.set(r, new Map());
      const scopes = resources.get(r);
      if (!scopes.has(s)) scopes.set(s, []);
      scopes.get(s).push(span);
    }
    return {
      resourceSpans: [...resources].map(([r, scopes]) => ({
        resource: request.resourceSpans[r].resource,
        scopeSpans: [...scopes].map(([s, each]) => ({ scope: request.resourceSpans[r].scopeSpans[s].scope, spans: each })),
      })),
    };
  };
  const half = Math.ceil(spans.length / 2);
  return [...split(rebuild(spans.slice(0, half)), cap), ...split(rebuild(spans.slice(half)), cap)];
}

/**
 * The agent's receiver: OTLP/HTTP JSON on a loopback port, from loopback
 * only, never from a browser page. Each request is answered as soon as it is
 * read, then filtered; what the filter keeps goes to `keep`.
 *
 * With `secret`, the agent's key, it also answers `healthPath` with its
 * proof of a challenge, so `status` knows the agent listens and not another
 * program, and stops on a request to `stopPath` that proves the key.
 *
 * @param {{
 *   port: number,
 *   transform: (signal: string, request: any) => any,
 *   keep: (request: any, signal: string) => void,
 *   observe?: (signal: string, request: any, kept: any) => void,
 *   signal?: AbortSignal,
 *   secret?: string,
 *   stop?: () => void,
 *   now?: () => number,
 * }} options
 * @returns {Promise<{ port: number, closed: Promise<void> }>}
 */
export async function startAgent({ port, transform, keep, observe, signal, secret, stop, now = Date.now }) {
  let lastStop = 0;
  const server = http.createServer((request, response) => {
    const answer = (status, body = "") => {
      response.writeHead(status, body ? { "content-type": "application/json" } : {}).end(body);
    };
    // A body past the cap is not read: the answer goes, then the connection.
    const refuse = () => {
      response.on("finish", () => request.socket.destroy());
      response.writeHead(413, { connection: "close" }).end();
    };
    if (!loopback(request.socket.remoteAddress)) {
      request.socket.destroy();
      return;
    }
    // A page in a browser could post here; the tools never send an Origin.
    if (request.headers.origin !== undefined) return answer(403);
    const url = new URL(request.url ?? "/", "http://agent");
    if (secret && request.method === "GET" && url.pathname === healthPath) {
      const challenge = url.searchParams.get("challenge") ?? "";
      if (!/^[0-9a-f]{32,128}$/.test(challenge)) return answer(400);
      return answer(200, JSON.stringify({ agent: "pharo-agent-telemetry", proof: proof(secret, "health", challenge) }));
    }
    if (secret && stop && request.method === "POST" && url.pathname === stopPath) {
      const at = Number(url.searchParams.get("at"));
      // A stop proves the key for a time of its own, within the window and after the last one: none is replayed.
      if (!Number.isInteger(at) || Math.abs(now() - at) > stopWindow || at <= lastStop || url.searchParams.get("proof") !== proof(secret, "stop", String(at))) return answer(403);
      lastStop = at;
      response.on("finish", () => stop());
      return answer(200, "{}");
    }
    const kind = signals[request.url ?? ""];
    if (request.method !== "POST" || kind === undefined) return answer(404);
    if (!/^application\/json\b/i.test(request.headers["content-type"] ?? "")) return answer(415);
    if (Number(request.headers["content-length"] ?? 0) > bodyCap) return refuse();
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      if (size > bodyCap) return;
      size += chunk.length;
      if (size > bodyCap) refuse();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > bodyCap) return;
      answer(200, "{}");
      setImmediate(() => handle(kind, Buffer.concat(chunks), request.headers["content-encoding"]));
    });
    request.on("error", () => {});
  });

  async function handle(kind, body, encoding) {
    try {
      const text = /\bgzip\b/i.test(encoding ?? "") ? zlib.gunzipSync(body, { maxOutputLength: bodyCap }).toString("utf8") : body.toString("utf8");
      const parsed = JSON.parse(text);
      const kept = await transform(kind, parsed);
      observe?.(kind, parsed, kept);
      if (kept) keep(kept, kind);
    } catch {
      // Malformed: dropped.
    }
  }

  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });
  const closed = new Promise((resolve) => {
    const stop = () => {
      server.close(() => resolve(undefined));
      server.closeAllConnections();
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  });
  return { port: /** @type {import("node:net").AddressInfo} */ (server.address()).port, closed };
}

/** The services the agent counts requests of by name; any other is "other". */
const counted = ["plexus", "pharo-mcp"];

/**
 * What the agent says in its state file: when it started, the requests it
 * received of each tool and when the last came, and what it sent. It stays
 * on this machine, for `status`.
 */
function agentState(forwarder, now = Date.now) {
  const started = new Date(now()).toISOString();
  /** @type {Record<string, { requests: number, kept: number, last: string }>} */
  const received = {};
  return {
    observe(signal, request, kept) {
      const services = new Set((request?.resourceSpans ?? []).map((each) => each?.resource?.attributes?.find?.((attribute) => attribute?.key === "service.name")?.value?.stringValue));
      for (const service of services.size === 0 ? [undefined] : services) {
        const name = counted.includes(service) ? service : "other";
        const entry = (received[name] ??= { requests: 0, kept: 0, last: started });
        entry.requests += 1;
        if (kept && signal === "traces") entry.kept += 1;
        entry.last = new Date(now()).toISOString();
      }
    },
    text() {
      const last = forwarder.last;
      return `${JSON.stringify({
        started,
        received,
        forwarded: { ...forwarder.counts, ...(last ? { last: { at: new Date(last.at).toISOString(), outcome: last.outcome } } : {}) },
        ...(forwarder.closedUntil > now() ? { pausedUntil: new Date(forwarder.closedUntil).toISOString() } : {}),
      }, null, 2)}\n`;
    },
  };
}

/**
 * The agent as its service runs it, until a signal or a stop request ends
 * it: the settings, filter and key in its directory, where `join` put them.
 *
 * @param {string} directory
 */
export async function runAgent(directory) {
  const { port, endpoint, token } = JSON.parse(fs.readFileSync(path.join(directory, "agent.json"), "utf8"));
  const { default: transform } = await import(pathToFileURL(path.join(directory, "telemetry-transform.mjs")).href);
  let secret;
  try {
    secret = fs.readFileSync(path.join(directory, "telemetry-transform.key"), "utf8").trim() || undefined;
  } catch {
    secret = undefined;
  }
  const forwarder = createForwarder({ endpoint, token });
  const state = agentState(forwarder);
  let pending;
  const save = () => {
    pending = undefined;
    const file = path.join(directory, stateFile);
    try {
      fs.writeFileSync(`${file}.tmp`, state.text(), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    } catch {
      // A state not written is a state not shown: nothing else depends on it.
    }
  };
  const changed = () => {
    pending ??= setTimeout(save, 2_000);
    pending.unref?.();
  };
  const stop = new AbortController();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(name, () => stop.abort());
  const { closed } = await startAgent({
    port,
    transform,
    keep: (request) => {
      for (const part of split(request)) forwarder.enqueue(part);
    },
    observe: (signal, request, kept) => {
      state.observe(signal, request, kept);
      changed();
    },
    signal: stop.signal,
    secret,
    stop: () => stop.abort(),
  });
  save();
  await closed;
  await Promise.race([forwarder.idle(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (pending) clearTimeout(pending);
  save();
}

/**
 * One request to a loopback port on a connection of its own: its status and
 * body, "refused" when nothing listens, or undefined when the connection
 * failed otherwise or took longer than `wait`.
 */
function ask(port, method, target, wait) {
  return new Promise((resolve) => {
    const request = http.request({ host: "127.0.0.1", port, method, path: target, agent: false, timeout: wait }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", () => resolve(undefined));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", (error) => resolve(/** @type {any} */ (error).code === "ECONNREFUSED" ? "refused" : undefined));
    request.end();
  });
}

/**
 * Who answers on a loopback port: the agent that holds `secret` ("agent"),
 * another program ("other"), or nobody ("none").
 *
 * @param {number} port
 * @param {string | undefined} secret
 * @returns {Promise<"agent" | "other" | "none">}
 */
export async function whoListens(port, secret, wait = 2_000) {
  const challenge = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const answer = await ask(port, "GET", `${healthPath}?challenge=${challenge}`, wait);
  if (answer === "refused") return "none";
  let said;
  try {
    said = JSON.parse(answer?.body ?? "");
  } catch {
    said = undefined;
  }
  return secret && answer?.status === 200 && said?.proof === proof(secret, "health", challenge) ? "agent" : "other";
}

/**
 * Asks the agent on a loopback port to stop, proving its key, and waits for
 * its port to close. Says whether it stopped.
 *
 * @param {number} port
 * @param {string} secret
 */
export async function stopAgent(port, secret, wait = 5_000) {
  const at = Date.now();
  const answer = await ask(port, "POST", `${stopPath}?at=${at}&proof=${proof(secret, "stop", String(at))}`, wait);
  if (answer === "refused" || answer?.status !== 200) return false;
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    if ((await whoListens(port, secret, 500)) === "none") return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(here)) {
  runAgent(path.dirname(here)).then(() => process.exit(0), () => process.exit(1));
}
