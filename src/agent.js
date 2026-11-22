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
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

/** The largest request taken, compressed or not, as the collector takes. */
export const bodyCap = 4 * 1024 * 1024;

/** What waits to be sent, at most: past it, a request is dropped. */
export const queueCap = { requests: 256, bytes: 16 * 1024 * 1024 };

/** How long sending stops after a failure: doubling from the first, up to the last. */
export const backoff = { first: 60_000, last: 3_600_000 };

/** How long a send may take, connection and answer included. */
export const sendTimeout = 10_000;

const signals = { "/v1/traces": "traces", "/v1/metrics": "metrics", "/v1/logs": "logs" };

const loopback = (address) => /^(?:127\.|::1$|::ffff:127\.)/.test(address ?? "");

/**
 * Sends requests to the collector one at a time, from a bounded queue, and
 * stops for a while after a failure, dropping what comes meanwhile: the data
 * is a sample, and a collector that is down is not asked again and again.
 *
 * @param {{ endpoint: string, token?: string, now?: () => number, send?: (body: string) => Promise<boolean> }} options
 */
export function createForwarder({ endpoint, token, now = Date.now, send }) {
  const target = new URL(`${endpoint.replace(/\/+$/, "")}/v1/traces`);
  const post = send ?? ((body) => postOnce(target, token, body));
  const queue = [];
  let queued = 0;
  let failures = 0;
  let closedUntil = 0;
  let running = false;
  const counts = { sent: 0, dropped: 0, failed: 0 };

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length > 0) {
      const body = queue.shift();
      queued -= Buffer.byteLength(body);
      if (now() < closedUntil) {
        counts.dropped += 1;
        continue;
      }
      if (await post(body).catch(() => false)) {
        failures = 0;
        counts.sent += 1;
      } else {
        failures += 1;
        counts.failed += 1;
        closedUntil = now() + Math.min(backoff.first * 2 ** (failures - 1), backoff.last);
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
      queue.push(body);
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
  };
}

/**
 * One POST to the collector: verified TLS, no redirect followed, an answer
 * within sendTimeout. True when the collector took it.
 */
function postOnce(target, token, body) {
  return new Promise((resolve) => {
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(target.protocol === "https:" ? { rejectUnauthorized: true } : {}),
      timeout: sendTimeout,
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode >= 200 && response.statusCode < 300));
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
 * The agent's receiver: OTLP/HTTP JSON on a loopback port, from loopback
 * only, never from a browser page. Each request is answered as soon as it is
 * read, then filtered; what the filter keeps goes to `keep`.
 *
 * @param {{
 *   port: number,
 *   transform: (signal: string, request: any) => any,
 *   keep: (request: any, signal: string) => void,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<{ port: number, closed: Promise<void> }>}
 */
export async function startAgent({ port, transform, keep, signal }) {
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
    const kind = signals[request.url ?? ""];
    if (request.method !== "POST" || kind === undefined) return answer(404);
    // A page in a browser could post here; the tools never send an Origin.
    if (request.headers.origin !== undefined) return answer(403);
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
      const kept = await transform(kind, JSON.parse(text));
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

/**
 * The agent as its service runs it, until a signal ends it: the settings,
 * filter and key in its directory, where `join` put them.
 *
 * @param {string} directory
 */
export async function runAgent(directory) {
  const { port, endpoint, token } = JSON.parse(fs.readFileSync(path.join(directory, "agent.json"), "utf8"));
  const { default: transform } = await import(pathToFileURL(path.join(directory, "telemetry-transform.mjs")).href);
  const forwarder = createForwarder({ endpoint, token });
  const stop = new AbortController();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(name, () => stop.abort());
  const { closed } = await startAgent({ port, transform, keep: (request) => forwarder.enqueue(JSON.stringify(request)), signal: stop.signal });
  await closed;
  await Promise.race([forwarder.idle(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(here)) {
  runAgent(path.dirname(here)).then(() => process.exit(0), () => process.exit(1));
}
