// `preview`: until it is stopped, the tools send to the agent run here in
// the foreground with sending off, which prints what it would send, so a
// person sees exactly what joining would send before sending anything. The
// settings files are put back as they were when the preview ends.
import crypto from "node:crypto";
import fs from "node:fs";
import { startAgent } from "./agent.js";
import { freePort } from "./install.js";
import { agentSettings, backUp, backupSuffix, readSettings, removeSettings, restoreBackup, settingsBlock, writeSettings } from "./settings.js";

/** A span's kind, by its number. */
const kindNames = ["unspecified", "internal", "server", "client", "producer", "consumer"];

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
 * its ids and week, and its attributes and where it ran.
 *
 * @param {any} request
 * @returns {string[]}
 */
export function describeRequest(request) {
  const lines = [];
  const attributeLines = (attributes) => (attributes ?? []).map(({ key, value }) => `    ${key} = ${valueText(value)}`);
  for (const resourceSpans of request?.resourceSpans ?? []) {
    const resource = attributeLines(resourceSpans.resource?.attributes);
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        const week = new Date(Number(BigInt(span.startTimeUnixNano ?? 0) / 1_000_000n)).toISOString().slice(0, 10);
        const failed = span.status?.code === 2 ? ", failed" : "";
        const kind = kindNames[span.kind] ?? "unspecified";
        lines.push(`${span.name} (${kind}, week of ${week}${failed}) trace ${span.traceId} span ${span.spanId}${span.parentSpanId ? ` parent ${span.parentSpanId}` : ""}`);
        lines.push(...attributeLines(span.attributes));
        lines.push(`  from ${scopeSpans.scope?.name}${scopeSpans.scope?.version ? ` ${scopeSpans.scope.version}` : ""}:`, ...resource.map((line) => `  ${line}`));
      }
    }
  }
  return lines;
}

/** A settings file a preview that was killed left behind, put back. */
export function recoverPreview(file) {
  const backup = `${file}${backupSuffix}`;
  if (readSettings(file)?.writer !== "preview") return;
  if (fs.existsSync(backup)) restoreBackup(file, backup);
  else removeSettings(file);
}

/**
 * Runs the preview until `signal` aborts.
 *
 * @param {{
 *   files: string[],
 *   filter: (key: string) => (signal: string, request: any) => any,
 *   key?: string,
 *   print: (line: string) => void,
 *   signal: AbortSignal,
 *   port?: number,
 * }} options `key`: the joined agent's, so ids hash as it hashes them
 * @returns {Promise<{ port: number, done: Promise<void> }>}
 */
export async function startPreview({ files, filter, key, print, signal, port }) {
  for (const file of files) recoverPreview(file);
  const transform = filter(key ?? crypto.randomBytes(32).toString("hex"));
  const started = await startAgent({
    port: port ?? (await freePort()),
    transform,
    // With the joined agent's key, status and join know a preview from another program.
    ...(key ? { secret: key, role: "preview" } : {}),
    keep: (request) => {
      for (const line of describeRequest(request)) print(line);
    },
    signal,
  });

  const backups = [];
  for (const file of files) {
    if (readSettings(file) !== undefined) {
      backUp(file, `${file}${backupSuffix}`);
      backups.push(file);
    }
    writeSettings(file, settingsBlock("preview", agentSettings({ port: started.port, environment: "preview" })));
  }

  // A leave run meanwhile has put the files back already: only a file that is still the preview's is.
  const done = started.closed.then(() => {
    for (const file of files) {
      if (readSettings(file)?.writer !== "preview") continue;
      const backup = `${file}${backupSuffix}`;
      if (backups.includes(file) && fs.existsSync(backup)) restoreBackup(file, backup);
      else removeSettings(file);
    }
  });
  return { port: started.port, done };
}
