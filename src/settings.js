// The settings files the Pharo tools read when their environment configures
// no OpenTelemetry of their own: PLexus's, which it passes on to the images
// it starts, and MCP's, which an image reads at every start. Both are
// `KEY=value` lines of standard OTEL_* variables. Joining writes a block of
// them in each, between two marked lines, pointing the tools at the agent on
// this machine; leaving removes both blocks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The marked lines a block of ours starts and ends with. */
const marker = "# pharo-agent-telemetry: ";
const endLine = `${marker}end`;

/** The tools whose settings file joining writes, by the directory each reads it from. */
export const settingsTools = ["plexus", "pharo-mcp"];

/** Where joining wrote before PLexus and MCP read files of their own: looked at by leave and status only. */
const earlierTools = ["pharo-agent"];

/** The agent's own directory, beside the tools' settings. */
export const agentTool = "pharo-agent-telemetry";

/** What a preview saves the settings file as while it runs. */
export const backupSuffix = ".before-preview";

/** What join saves a settings file it did not write as, for leave to put back. */
export const joinBackupSuffix = ".before-join";

/**
 * The configuration directories a tool may read its settings from, first the one it reads.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [home]
 */
function configDirectories(env = process.env, platform = process.platform, home = os.homedir()) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const xdg = env.XDG_CONFIG_HOME;
  const directories = [];
  if (xdg && paths.isAbsolute(xdg)) directories.push(xdg);
  if (platform === "win32" && env.APPDATA) directories.push(env.APPDATA);
  directories.push(paths.join(home, ".config"));
  if (platform === "win32") directories.push(paths.join(home, "AppData", "Roaming"));
  return { paths, directories: [...new Set(directories)] };
}

/**
 * A tool's settings directory, as the tools find theirs: under
 * `$XDG_CONFIG_HOME`, `%APPDATA%` on Windows, `~/.config` otherwise.
 *
 * @param {string} tool plexus, pharo-mcp or pharo-agent-telemetry
 */
export function configDirectory(tool, env = process.env, platform = process.platform, home = os.homedir()) {
  const { paths, directories } = configDirectories(env, platform, home);
  return paths.join(directories[0], tool);
}

/**
 * The settings files joining writes: each tool's as this environment finds
 * it, and, when it differs, as a tool started without XDG_CONFIG_HOME finds
 * it (`~/.config`, `%APPDATA%` on Windows), as an agent host started from
 * the desktop does, or Pharo on Windows, which reads a `C:/` path as
 * relative.
 */
export function settingsFiles(env = process.env, platform = process.platform, home = os.homedir()) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const without = { ...env, XDG_CONFIG_HOME: undefined };
  return [...new Set([env, without].flatMap((each) => settingsTools.map((tool) => paths.join(configDirectory(tool, each, platform, home), "otel.env"))))];
}

/**
 * Every place a settings file this package wrote may be: each tool's, under
 * every configuration directory it may have found (the environment that runs
 * `leave` need not be the agent host's or the image's), and the earlier
 * shared `pharo-agent/otel.env`.
 */
export function everySettingsFile(env = process.env, platform = process.platform, home = os.homedir()) {
  const { paths, directories } = configDirectories(env, platform, home);
  return [...new Set([...settingsTools, ...earlierTools].flatMap((tool) => directories.map((directory) => paths.join(directory, tool, "otel.env"))))];
}

/** Every place the agent's directory may be. */
export function everyAgentDirectory(env = process.env, platform = process.platform, home = os.homedir()) {
  const { paths, directories } = configDirectories(env, platform, home);
  return directories.map((directory) => paths.join(directory, agentTool));
}

/**
 * The settings that send traces, and only traces, to the agent on this
 * machine. They hold no token: the agent alone knows the collector.
 *
 * @param {{ port: number, environment?: string }} options
 * @returns {Record<string, string>}
 */
export function agentSettings({ port, environment = "field" }) {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_TRACES_EXPORTER: "otlp",
    // A Pharo image stopped without saving loses what it had not sent yet:
    // send every second rather than every five.
    OTEL_BSP_SCHEDULE_DELAY: "1000",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
    // An image whose agent is down, or gone after leave, prints nothing of it.
    OTEL_LOG_LEVEL: "none",
    OTEL_RESOURCE_ATTRIBUTES: `deployment.environment.name=${environment}`,
  };
}

/**
 * A block of settings between the lines that mark it as this package's.
 *
 * @param {string} purpose joined or preview
 * @param {Record<string, string>} settings
 */
export function settingsBlock(purpose, settings) {
  const lines = Object.entries(settings).map(([key, value]) => `${key}=${value}`);
  return `${marker}${purpose}. Run \`npx @evref-bl/pharo-agent-telemetry leave\`, or delete these lines down to the end line, to stop.\n${lines.join("\n")}\n${endLine}\n`;
}

const isSetting = (line) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line);

/**
 * What a settings file says, and who wrote it: `joined`, `preview` or
 * `by hand` when it holds a block of ours, `other` when it holds settings
 * and no block of ours, undefined when there is no file. `others` says
 * whether settings stand outside our block.
 *
 * @param {string} file
 * @returns {{ writer: "joined" | "preview" | "by hand" | "other", text: string, others: boolean, outside: string } | undefined}
 */
export function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(marker) && line !== endLine);
  const end = start === -1 ? -1 : lines.findIndex((line, index) => index > start && line.trim() === endLine);
  const block = start === -1 ? [] : lines.slice(start, end === -1 ? lines.length : end + 1);
  const outside = start === -1 ? lines : [...lines.slice(0, start), ...(end === -1 ? [] : lines.slice(end + 1))];
  const others = outside.some(isSetting);
  if (start === -1) return { writer: "other", text, others, outside: text };
  const purpose = lines[start].slice(marker.length).split(".")[0];
  const writer = purpose === "joined" ? "joined" : purpose === "preview" ? "preview" : "by hand";
  return { writer, text, others, outside: outside.join("\n").replace(/^\n+|\n+$/g, ""), block: block.join("\n") };
}

/** Whether a path is a symbolic link. */
function isLink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The file a write goes to: a symbolic link's target, so the link stays a link. */
function target(file) {
  return isLink(file) ? fs.realpathSync(file) : file;
}

/** A file's permissions, or undefined when there is no file. */
function modeOf(file) {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return undefined;
  }
}

/**
 * Writes the file whole, so a tool starting meanwhile reads all of it or
 * none; through a symbolic link, into the file it points to. A file that is
 * there keeps its permissions, unless `mode` says otherwise; a new one is
 * readable by its owner only.
 *
 * @param {string} file
 * @param {string} text
 * @param {number} [mode]
 */
export function writeSettings(file, text, mode) {
  const written = target(file);
  mode ??= modeOf(written) ?? 0o600;
  fs.mkdirSync(path.dirname(written), { recursive: true });
  const temporary = `${written}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode });
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, written);
}

/**
 * Keeps what a settings file holds in `backup`, readable by its owner only:
 * the file's text, or `text` when given (the settings of your own outside a
 * block of ours).
 */
export function backUp(file, backup, text = fs.readFileSync(file, "utf8")) {
  writeSettings(backup, text, 0o600);
}

/**
 * Puts a backup back where it was taken, through a symbolic link if the file
 * is one, and removes it. The file keeps its own permissions: the backup's
 * are its owner's only, whatever the file's were.
 */
export function restoreBackup(file, backup) {
  writeSettings(file, fs.readFileSync(backup, "utf8"));
  fs.rmSync(backup, { force: true });
}

/**
 * Why a settings file could not be written, or undefined when it can be:
 * checked before anything is installed, so a join never stops halfway.
 *
 * @param {string} file
 */
export function unwritable(file) {
  try {
    const written = target(file);
    let directory = path.dirname(written);
    while (!fs.existsSync(directory)) directory = path.dirname(directory);
    fs.accessSync(directory, fs.constants.W_OK);
    if (fs.existsSync(written)) fs.accessSync(written, fs.constants.W_OK);
    return undefined;
  } catch (error) {
    return `${file} cannot be written (${error instanceof Error && "code" in error ? error.code : error}): join would stop halfway. Make its directory writable, then run join again.`;
  }
}

/**
 * Takes our block out of a settings file: the file goes when nothing else
 * of substance is left in it. With `force`, the file goes whatever it holds.
 *
 * @param {string} file
 * @param {{ force?: boolean }} [options]
 * @returns {"removed" | "kept others" | "not ours" | "absent"}
 */
export function removeSettings(file, { force = false } = {}) {
  const current = readSettings(file);
  if (current === undefined) return "absent";
  if (force || (current.writer !== "other" && !current.others)) {
    // A symbolic link stays, and points to what is left: nothing of ours.
    if (isLink(file)) writeSettings(file, force ? "" : `${current.outside}${current.outside ? "\n" : ""}`);
    else fs.rmSync(file, { force: true });
    return "removed";
  }
  if (current.writer === "other") return "not ours";
  writeSettings(file, `${current.outside}\n`);
  return "kept others";
}

/**
 * The names of the settings a file holds outside our block, as `status`
 * shows them: their values may be secrets (a collector's token in
 * OTEL_EXPORTER_OTLP_HEADERS), and are never printed.
 *
 * @param {string} text
 */
export function ownSettingNames(text) {
  return text.split(/\r?\n/).filter(isSetting).map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1]).filter(Boolean);
}

/**
 * Where PLexus remembers a collector it could not reach, and stops sending
 * to it for up to six hours: `$XDG_CACHE_HOME/plexus`, and the directory it
 * uses without one (`~/.cache/plexus`, `%LOCALAPPDATA%\\plexus` on Windows).
 */
export function reachabilityFiles(env = process.env, platform = process.platform, home = os.homedir()) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const fallback = platform === "win32" ? env.LOCALAPPDATA?.trim() || paths.join(home, "AppData", "Local") : paths.join(home, ".cache");
  return [...new Set([env.XDG_CACHE_HOME?.trim(), fallback].filter(Boolean).map((directory) => paths.join(directory, "plexus", "otel-reachability.json")))];
}

/**
 * Forgets that PLexus could not reach the agent on these ports: a join or a
 * preview that starts it again is sent to at once, not hours later.
 *
 * @param {number[]} ports
 * @returns {string[]} the files changed
 */
export function clearReachability(ports, env = process.env, platform = process.platform, home = os.homedir()) {
  const endpoints = ports.map((port) => `http://127.0.0.1:${port}/v1/traces`);
  return reachabilityFiles(env, platform, home).filter((file) => {
    let state;
    try {
      state = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return false;
    }
    if (state === null || typeof state !== "object" || !endpoints.some((endpoint) => endpoint in state)) return false;
    for (const endpoint of endpoints) delete state[endpoint];
    try {
      writeSettings(file, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  });
}
