// The settings file every Pharo tool reads when its environment configures
// no OpenTelemetry of its own: `KEY=value` lines of standard OTEL_*
// variables. Joining writes it, leaving deletes it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The first line of a file this package wrote, and what it wrote it for. */
const marker = "# Written by pharo-agent-telemetry";

/**
 * Where the settings live: the same place the plugin, PLexus and MCP look.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [home]
 */
export function settingsFile(env = process.env, platform = process.platform, home = os.homedir()) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg && paths.isAbsolute(xdg)) return paths.join(xdg, "pharo-agent", "otel.env");
  if (platform === "win32" && env.APPDATA) return paths.join(env.APPDATA, "pharo-agent", "otel.env");
  return paths.join(home, ".config", "pharo-agent", "otel.env");
}

/**
 * The settings that send traces, and only traces, to a collector.
 *
 * @param {{ endpoint: string, token?: string, protocol?: "http/protobuf" | "http/json", environment?: string }} options
 * @returns {Record<string, string>}
 */
export function collectorSettings({ endpoint, token, protocol = "http/protobuf", environment = "field" }) {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint.replace(/\/+$/, ""),
    OTEL_EXPORTER_OTLP_PROTOCOL: protocol,
    ...(token ? { OTEL_EXPORTER_OTLP_HEADERS: `authorization=Bearer%20${encodeURIComponent(token)}` } : {}),
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
    OTEL_RESOURCE_ATTRIBUTES: `deployment.environment.name=${environment}`,
  };
}

/**
 * @param {string} purpose joined or preview
 * @param {Record<string, string>} settings
 */
export function settingsText(purpose, settings) {
  const lines = Object.entries(settings).map(([key, value]) => `${key}=${value}`);
  return `${marker} (${purpose}). Delete this file, or run \`npx @evref-bl/pharo-agent-telemetry leave\`, to stop.\n${lines.join("\n")}\n`;
}

/**
 * What the file says, and who wrote it: `joined` or `preview` when this
 * package did, `other` when someone else did, undefined when there is none.
 *
 * @param {string} file
 * @returns {{ writer: "joined" | "preview" | "other", text: string } | undefined}
 */
export function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const first = text.split(/\r?\n/, 1)[0];
  if (first.startsWith(`${marker} (joined)`)) return { writer: "joined", text };
  if (first.startsWith(`${marker} (preview)`)) return { writer: "preview", text };
  return { writer: "other", text };
}

/**
 * Writes the file whole, so a tool starting meanwhile reads all of it or none.
 *
 * @param {string} file
 * @param {string} text
 */
export function writeSettings(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** @param {string} file */
export function removeSettings(file) {
  fs.rmSync(file, { force: true });
}
