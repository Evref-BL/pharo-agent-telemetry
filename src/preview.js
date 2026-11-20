// `preview`: until it is stopped, the tools send to a receiver on this
// machine instead, which prints each span, so a person sees what joining
// would send before sending anything. The settings file is put back as it
// was when the preview ends.
import fs from "node:fs";
import http from "node:http";
import { collectorSettings, readSettings, removeSettings, settingsText, writeSettings } from "./settings.js";

/**
 * @typedef {{ key: string, value: Record<string, unknown> }} KeyValue
 * @typedef {{ resource: Record<string, string>, span: Record<string, string> }} Allowlist
 */

/** An OTLP JSON attribute value, as text. */
function valueText(value) {
  if ("stringValue" in value) return JSON.stringify(value.stringValue);
  if ("intValue" in value) return String(value.intValue);
  if ("doubleValue" in value) return String(value.doubleValue);
  if ("boolValue" in value) return String(value.boolValue);
  if ("arrayValue" in value) {
    const values = /** @type {{ values?: Record<string, unknown>[] }} */ (value.arrayValue).values ?? [];
    return `[${values.map(valueText).join(", ")}]`;
  }
  return JSON.stringify(value);
}

/**
 * Each span of an OTLP JSON request, as lines a person reads: what it was,
 * how long it took, and its attributes, those the collector would drop
 * marked so.
 *
 * @param {any} request
 * @param {Allowlist} allowlist
 * @returns {string[]}
 */
export function describeRequest(request, allowlist) {
  const lines = [];
  const attributeLines = (/** @type {KeyValue[]} */ attributes, /** @type {Record<string, string>} */ kept) =>
    (attributes ?? []).map(({ key, value }) => `    ${key} = ${valueText(value)}${key in kept ? "" : "   (dropped by the collector)"}`);
  for (const resourceSpans of request?.resourceSpans ?? []) {
    const resource = attributeLines(resourceSpans.resource?.attributes, allowlist.resource);
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        const milliseconds = (Number(BigInt(span.endTimeUnixNano ?? 0) - BigInt(span.startTimeUnixNano ?? 0)) / 1e6).toFixed(1);
        const failed = span.status?.code === 2 ? ", failed" : "";
        lines.push(`${span.name} (${milliseconds} ms${failed})`);
        lines.push(...attributeLines(span.attributes, allowlist.span));
        if (span.events?.length) lines.push(`    ${span.events.length} event(s)   (dropped by the collector)`);
        lines.push("  from:", ...resource.map((line) => `  ${line}`));
      }
    }
  }
  return lines;
}

/**
 * Runs the preview until `signal` aborts.
 *
 * @param {{ file: string, allowlist: Allowlist, print: (line: string) => void, signal: AbortSignal, port?: number }} options
 * @returns {Promise<{ port: number, done: Promise<void> }>}
 */
export async function startPreview({ file, allowlist, print, signal, port = 0 }) {
  const backup = `${file}.before-preview`;
  // A preview that was killed left its settings and the backup behind.
  const current = readSettings(file);
  if (current?.writer === "preview" && fs.existsSync(backup)) {
    fs.renameSync(backup, file);
  } else if (current?.writer === "preview") {
    removeSettings(file);
  }
  const previous = readSettings(file);

  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/traces") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8").on("data", (chunk) => { body += chunk; }).on("end", () => {
      try {
        for (const line of describeRequest(JSON.parse(body), allowlist)) print(line);
      } catch {
        print("(a request this preview could not read)");
      }
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(undefined)));
  const { port: bound } = /** @type {import("node:net").AddressInfo} */ (server.address());

  if (previous) fs.copyFileSync(file, backup);
  writeSettings(file, settingsText("preview", collectorSettings({
    endpoint: `http://127.0.0.1:${bound}`,
    protocol: "http/json",
    environment: "preview",
  })));

  const done = new Promise((resolve) => {
    const stop = () => {
      if (previous) fs.renameSync(backup, file);
      else removeSettings(file);
      server.close(() => resolve(undefined));
      server.closeAllConnections();
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  return { port: bound, done: /** @type {Promise<void>} */ (done) };
}
