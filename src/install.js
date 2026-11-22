// The agent's files, in its own directory: what its service runs, never a
// copy in npx's cache, which comes and goes. agent.mjs and the filter come
// from this package; agent.json says where to send and on which port to
// listen; the key hashes ids and never leaves the machine.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** The files of this package the agent runs, by the name they get in its directory. */
export const packaged = {
  "agent.mjs": new URL("./agent.js", import.meta.url),
  "telemetry-transform.mjs": new URL("./telemetry-transform.mjs", import.meta.url),
};
export const configFile = "agent.json";
export const keyFile = "telemetry-transform.key";

const validKey = (text) => /^[0-9a-f]{32,128}$/.test((text ?? "").trim());

function readOrUndefined(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function write(file, text, mode) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode });
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, file);
}

/** A loopback port nothing listens on now. */
export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return port;
}

/** The agent's settings, when it has some. @returns {{ port: number, endpoint: string, token?: string } | undefined} */
export function readAgentConfig(directory) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(directory, configFile), "utf8"));
    return Number.isInteger(config.port) && typeof config.endpoint === "string" ? config : undefined;
  } catch {
    return undefined;
  }
}

/** The agent's key, when it has a valid one. */
export function readKey(directory) {
  const text = readOrUndefined(path.join(directory, keyFile))?.trim();
  return validKey(text) ? text : undefined;
}

/**
 * Writes the agent's files. The key is kept when a valid one is there, so
 * the ids of one call still group across restarts and joins; the port too,
 * so the tools' settings stay right.
 *
 * @param {string} directory
 * @param {{ endpoint: string, token?: string, port: number }} config
 */
export function installAgent(directory, config) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  for (const [name, source] of Object.entries(packaged)) write(path.join(directory, name), fs.readFileSync(source, "utf8"), 0o644);
  write(path.join(directory, configFile), `${JSON.stringify(config, null, 2)}\n`, 0o600);
  if (readKey(directory) === undefined) write(path.join(directory, keyFile), `${crypto.randomBytes(32).toString("hex")}\n`, 0o600);
  return { agent: path.join(directory, "agent.mjs") };
}

/**
 * Removes the agent's files, and its directory once empty.
 *
 * @returns {string[]} the files removed
 */
export function removeAgent(directory) {
  const removed = [...Object.keys(packaged), configFile, keyFile].map((name) => path.join(directory, name)).filter((file) => {
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file, { force: true });
    return true;
  });
  try {
    fs.rmdirSync(directory);
  } catch {
    // Not empty, or not there.
  }
  return removed;
}

/** The version a filter's text declares. */
export function filterVersion(text) {
  return /^export const version = "([^"]+)";$/m.exec(text ?? "")?.[1];
}

/**
 * Whether the agent's files are there, this package's, and complete.
 *
 * @returns {{ present: boolean, version?: string, current: boolean, key: boolean, config?: ReturnType<typeof readAgentConfig> }}
 */
export function agentStatus(directory) {
  const texts = Object.fromEntries(Object.keys(packaged).map((name) => [name, readOrUndefined(path.join(directory, name))]));
  return {
    present: Object.values(texts).some((text) => text !== undefined),
    version: filterVersion(texts["telemetry-transform.mjs"]),
    current: Object.entries(packaged).every(([name, source]) => texts[name] === fs.readFileSync(source, "utf8")),
    key: readKey(directory) !== undefined,
    config: readAgentConfig(directory),
  };
}
