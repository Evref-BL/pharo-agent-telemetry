// The agent's files, in its own directory: what its service runs, never a
// copy in npx's cache, which comes and goes. agent.mjs comes from this
// package, the filter from the study's; agent.json says which study, where to
// send and on which port to listen; the key hashes ids and never leaves the
// machine.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { studyFilter } from "./generate.js";

/** The agent, as this package ships it. */
export const agentSource = fileURLToPath(new URL("./agent.js", import.meta.url));

/** The names of the files the agent runs, in its directory. */
const packagedNames = ["agent.mjs", "telemetry-transform.mjs"];

/**
 * The files the agent of a study runs, by the name they get in its
 * directory, and their text: this package's agent, and the filter the
 * study's data makes with this package's rules. Without a study, the agent
 * alone.
 *
 * @param {import("./study.js").Study} [study]
 * @returns {Record<string, string>}
 */
export function packagedFiles(study) {
  return { "agent.mjs": fs.readFileSync(agentSource, "utf8"), ...(study ? { "telemetry-transform.mjs": studyFilter(study) } : {}) };
}
export const configFile = "agent.json";
export const keyFile = "telemetry-transform.key";
/** What the agent says it received and sent, as src/agent.js writes it. */
export const stateFile = "state.json";

/** The files the agent writes in its directory as it runs, which leave removes with the others. */
export const agentFiles = [stateFile, "sessions.json", "catalog.json", "preview.json"];

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

/**
 * The ports the agent takes one of: below every system's ephemeral range
 * (Linux's starts at 32768, macOS's and Windows' at 49152), from which the
 * system hands any program a port while the agent is down, and above those
 * development servers favour.
 */
export const agentPorts = { first: 20000, last: 32767 };

/** The loopback port a listener got when it asked for `port`, or undefined when something listens there. */
async function bound(port) {
  const server = net.createServer();
  const listening = await new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  if (!listening) return undefined;
  const { port: got } = /** @type {net.AddressInfo} */ (server.address());
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return got;
}

/** A loopback port among the agent's that nothing listens on now. */
export async function freePort(random = Math.random) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = await bound(agentPorts.first + Math.floor(random() * (agentPorts.last - agentPorts.first + 1)));
    if (port !== undefined) return port;
  }
  throw new Error(`No port between ${agentPorts.first} and ${agentPorts.last} is free.`);
}

/** The agent's settings, when it has some. @returns {{ study?: string, port: number, endpoint: string, token?: string, catalog?: { url: string, publicKey: string }, service?: false } | undefined} */
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
 * @param {{ study?: string, endpoint: string, token?: string, port: number }} config
 * @param {Record<string, string>} files packagedFiles of the study: names and texts
 */
export function installAgent(directory, config, files) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  for (const [name, text] of Object.entries(files)) write(path.join(directory, name), text, 0o644);
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
  const removed = [...packagedNames, configFile, keyFile, ...agentFiles].flatMap((name) => [name, `${name}.tmp`]).map((name) => path.join(directory, name)).filter((file) => {
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

/** What the agent last said it received and sent, when it said anything. */
export function readAgentState(directory) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(directory, stateFile), "utf8"));
    return state && typeof state === "object" ? state : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the agent's files are there, and complete, and whether they are
 * the ones given: packagedFiles of a study, or this package's agent alone.
 *
 * @param {string} directory
 * @param {Record<string, string>} [files]
 * @returns {{ present: boolean, version?: string, current: boolean, key: boolean, config?: ReturnType<typeof readAgentConfig>, state?: any }}
 */
export function agentStatus(directory, files = packagedFiles()) {
  const texts = Object.fromEntries(packagedNames.map((name) => [name, readOrUndefined(path.join(directory, name))]));
  return {
    present: Object.values(texts).some((text) => text !== undefined),
    version: filterVersion(texts["telemetry-transform.mjs"]),
    current: Object.entries(files).every(([name, text]) => texts[name] === text),
    key: readKey(directory) !== undefined,
    config: readAgentConfig(directory),
    state: readAgentState(directory),
  };
}
