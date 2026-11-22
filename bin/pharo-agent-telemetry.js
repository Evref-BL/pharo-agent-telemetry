#!/usr/bin/env node
// Join, preview or leave the Pharo agent tools' field telemetry.
//
// Every command acts on the agent of the home it runs for, as HOME and
// XDG_CONFIG_HOME say, and on that agent's own service: see src/service.js.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runAgent, stopAgent, whoListens } from "../src/agent.js";
import { missingForJoin, publicEndpoint, publicToken } from "../src/collector.js";
import { agentPorts, agentStatus, freePort, installAgent, packaged, readAgentConfig, readKey, removeAgent } from "../src/install.js";
import { recoverPreview, startPreview } from "../src/preview.js";
import { definedAgentDirectories, dryRun, installService, realServices, removeService, runCommand, serviceState, stableNode, startService } from "../src/service.js";
import {
  agentSettings, agentTool, backUp, backupSuffix, clearReachability, configDirectory, everyAgentDirectory, everySettingsFile, joinBackupSuffix, ownSettingNames,
  readSettings, removeSettings, restoreBackup, settingsBlock, settingsFiles, settingsTools, unwritable, writeSettings,
} from "../src/settings.js";

const usage = `Usage: pharo-agent-telemetry <command>

  preview   Show what the tools would send, sending nothing, until Ctrl-C.
  join      Install the agent, and point the tools at it.
  status    Say whether you joined, and how the agent is.
  leave     Stop and remove the agent, and the tools' settings.
  agent     Run the installed agent in the foreground, as its service does.

What is sent: https://github.com/Evref-BL/pharo-agent-telemetry/blob/main/docs/participants.md

Options for join:
  --endpoint <url>   Another collector than the project's.
  --token <token>    That collector's token.
  --force            Replace OpenTelemetry settings you wrote yourself; leave puts them back.
  --no-service       Install no service: the agent sends only while the agent command runs.
Options for leave:
  --force            Remove each settings file whole, settings of your own in it included.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    endpoint: { type: "string" },
    token: { type: "string" },
    force: { type: "boolean" },
    "no-service": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const [command] = positionals;
const files = settingsFiles();
const agentDirectory = configDirectory(agentTool);
// A test sets PHARO_AGENT_TELEMETRY_DRY_RUN to a file: the service commands
// are written there instead of run, and nothing is installed; or
// PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS to a directory of fake commands,
// run instead of the real ones. Either way no agent starts.
// Otherwise this command, and nothing else, opts in to the real service manager.
const run = process.env.PHARO_AGENT_TELEMETRY_DRY_RUN
  ? dryRun(process.env.PHARO_AGENT_TELEMETRY_DRY_RUN)
  : (command, args) => runCommand(command, args, { ...process.env, ...realServices });
const faked = Boolean(process.env.PHARO_AGENT_TELEMETRY_DRY_RUN || process.env.PHARO_AGENT_TELEMETRY_SERVICE_COMMANDS);
const serviceOf = (directory) => ({ agent: path.join(directory, "agent.mjs"), run });
const service = serviceOf(agentDirectory);

/** Every agent directory of this home: where this environment puts one, and where this home's service definitions run one. */
const allAgentDirectories = () => [...new Set([...everyAgentDirectory(), ...definedAgentDirectories()])];

/** Every settings file of this home: where this environment finds them, and beside every agent directory found. */
const allSettingsFiles = () => [...new Set([
  ...everySettingsFile(),
  ...allAgentDirectories().flatMap((directory) => [...settingsTools, "pharo-agent"].map((tool) => path.join(path.dirname(directory), tool, "otel.env"))),
])];

/** Where a joined preview says it runs in the agent's place, in the agent's directory. */
const previewMark = (directory) => path.join(directory, "preview.json");

/** Whether a process runs. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {any} */ (error).code === "EPERM";
  }
}

/** A joined preview's mark, and whether its process still runs. */
function previewOf(directory) {
  try {
    const { pid } = JSON.parse(fs.readFileSync(previewMark(directory), "utf8"));
    return Number.isInteger(pid) ? { running: alive(pid) } : undefined;
  } catch {
    return undefined;
  }
}
const hostRestart = "Restart your agent host (Claude Code, Codex, OpenCode...) now: PLexus reads these settings when it starts, and images made before that restart send nothing until they are made again.";
const mcpAlone = "Using MCP in an image of your own, without PLexus? Load MCP's Telemetry group from the repository MCP came from, evaluate `MCP useOpenTelemetryObservabilityByDefault` and save the image: the participants page says how.";

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Whether the agent answers on its port, within `wait` milliseconds. */
async function answers(port, key, wait) {
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    if ((await whoListens(port, key, 500)) === "agent") return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function join() {
  const endpoint = values.endpoint ?? publicEndpoint;
  const token = values.token ?? (values.endpoint ? undefined : publicToken);
  const withService = !values["no-service"];
  const missing = values.endpoint ? [] : missingForJoin();
  if (missing.length > 0) fail(`The project's collector is not ready: its ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set yet. Give --endpoint to send to another one.`);
  // Everything that could stop the join is checked before anything is written.
  for (const file of files) {
    if (fs.existsSync(file) && readSettings(file) === undefined) fail(`${file} cannot be read: join would replace it without keeping it. Make it readable, or move it away, then run join again.`);
    const current = readSettings(file);
    if (current?.writer === "preview") fail("A preview is running. Stop it first.");
    if (current?.others && !values.force) fail(`${file} holds OpenTelemetry settings this command did not write. Run join --force to replace them; leave puts them back.`);
    const backup = `${file}${joinBackupSuffix}`;
    // A backup leave would put back over what the file holds now is never taken as it is.
    if (fs.existsSync(backup) && current?.writer !== "joined" && current?.text !== fs.readFileSync(backup, "utf8")) {
      fail(`${backup} holds what ${file} held before an earlier join, and ${file} ${current === undefined ? "is gone" : "has changed"} since. Keep the one you want, remove the other, and run join again.`);
    }
    const problem = unwritable(file);
    if (problem) fail(problem);
  }
  const earlier = readAgentConfig(agentDirectory);
  const earlierKey = readKey(agentDirectory);
  if (previewOf(agentDirectory)?.running || (earlier && earlierKey && (await whoListens(earlier.port, earlierKey)) === "preview")) fail("A preview runs in the agent's place. Stop it first.");
  // What is yours in each file is kept for leave to put back: a file of your own whole, or your settings beside an earlier block of ours.
  const backups = [];
  for (const file of files) {
    const current = readSettings(file);
    const backup = `${file}${joinBackupSuffix}`;
    if (current === undefined || fs.existsSync(backup)) continue;
    if (current.writer === "other" && current.text.trim() !== "") backUp(file, backup);
    else if (current.writer !== "other" && current.others) backUp(file, backup, `${current.outside}\n`);
    else continue;
    backups.push(backup);
  }
  // The agent of an earlier join stops first: on Windows, ending its task leaves its node running on the port.
  if (earlier && earlierKey) await stopAgent(earlier.port, earlierKey);
  fs.rmSync(previewMark(agentDirectory), { force: true });
  // A port from before the agent's ports were below the systems' ephemeral ranges moves.
  const port = earlier && earlier.port <= agentPorts.last ? earlier.port : await freePort();
  installAgent(agentDirectory, { port, endpoint, token, ...(withService ? {} : { service: false }) });
  if (withService) {
    try {
      installService(service);
    } catch (error) {
      // Nothing of a first join stays behind, least of all a service that would start at the next login.
      if (earlier === undefined) {
        removeService(service);
        removeAgent(agentDirectory);
        for (const backup of backups) fs.rmSync(backup, { force: true });
      }
      fail(`Could not start the agent as a service: ${error instanceof Error ? error.message : error}. This account's service manager refused it, as it may in a session without a desktop (over SSH on macOS, or on Linux without a systemd user session). ${earlier === undefined ? "Nothing was installed, and nothing is sent." : "Nothing is sent until it starts."} To join without a service, run join --no-service, then keep \`npx @evref-bl/pharo-agent-telemetry agent\` running in a terminal while you work.`);
    }
  } else {
    removeService(service);
  }
  for (const file of files) writeSettings(file, settingsBlock("joined", agentSettings({ port })));
  // PLexus stops sending for hours to an endpoint it could not reach, as the agent's while it was down.
  clearReachability([port, ...(earlier && earlier.port !== port ? [earlier.port] : [])]);
  console.log(`Joined: the Pharo tools send their traces to the agent on 127.0.0.1:${port}, which keeps only what the participants page lists and sends it to ${endpoint}.`);
  if (!withService) {
    console.log("No service runs the agent: it sends only while `npx @evref-bl/pharo-agent-telemetry agent` runs. Keep it running in a terminal while you work.");
  } else if (!faked && !(await answers(port, readKey(agentDirectory), 5_000))) {
    console.log("The agent does not answer yet: run status in a moment.");
  }
  console.log(hostRestart);
  console.log(mcpAlone);
  console.log(`Agent: ${agentDirectory}`);
  const { node, lasts } = stableNode();
  if (withService && !lasts) console.log(`The agent runs ${node}, which goes away when that Node is upgraded or removed: run join again then.`);
  for (const file of files) console.log(`Settings: ${file}`);
  for (const backup of backups) console.log(`What was yours: ${backup}, which leave puts back.`);
}

async function leave() {
  for (const file of allSettingsFiles()) {
    recoverPreview(file);
    fs.rmSync(`${file}${backupSuffix}`, { force: true });
    const current = readSettings(file);
    const before = `${file}${joinBackupSuffix}`;
    const kept = fs.existsSync(before);
    if (current === undefined) {
      if (kept && !fs.existsSync(file)) {
        restoreBackup(file, before);
        console.log(`Put back ${file} as it was before join.`);
      } else if (kept) {
        console.log(`${file} cannot be read: left as it is. What it held before join is in ${before}.`);
      }
      continue;
    }
    // A file without a block of ours is someone else's: left as it is.
    if (current.writer === "other") {
      if (kept) console.log(`${file} holds no block of ours: left as it is. What it held before join is in ${before}.`);
      continue;
    }
    if (kept && !current.others) {
      restoreBackup(file, before);
      console.log(`Put back ${file} as it was before join.`);
      continue;
    }
    const where = kept ? ` What it held before join is in ${before}.` : "";
    if (removeSettings(file, { force: values.force }) === "kept others") {
      console.log(`Removed the block from ${file}; the settings of your own in it stay.${where}`);
    } else {
      console.log(`Removed ${file}.${where}`);
    }
  }
  let stopped = false;
  for (const directory of allAgentDirectories()) {
    const config = readAgentConfig(directory);
    const key = readKey(directory);
    // Only an agent that proves this directory's key stops: another home's never does.
    if (config && key) await stopAgent(config.port, key);
    const hadService = removeService(serviceOf(directory));
    const removed = removeAgent(directory);
    stopped ||= hadService || removed.length > 0;
  }
  if (stopped) console.log("Stopped and removed the agent, its files and its key.");
  console.log("Left: sending stops at once. PLexus and the images now find the agent's port closed, and nothing else leaves this machine. Images keep running.");
}

/** How long ago an ISO time was, in words. */
function ago(iso) {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "at an unknown time";
  if (seconds < 90) return `${Math.max(seconds, 0)} s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
}

/** What the agent's state file says, as lines. */
function stateLines(state, port) {
  if (state === undefined) return [];
  const received = Object.entries(state.received ?? {});
  const lines = [received.length === 0
    ? `Received: nothing since the agent started, ${ago(state.started)}: no tool sends to 127.0.0.1:${port} yet.`
    : `Received since the agent started (${ago(state.started)}): ${received.map(([name, each]) => `${name} ${each.requests} request(s), the last ${ago(each.last)}`).join("; ")}.`];
  const forwarded = state.forwarded ?? {};
  if (forwarded.last) {
    lines.push(`Sent to the collector: ${forwarded.sent ?? 0} request(s), ${forwarded.failed ?? 0} failed, ${forwarded.refused ?? 0} refused, ${forwarded.dropped ?? 0} dropped; the last send ${ago(forwarded.last.at)}: ${forwarded.last.outcome}.`);
  }
  if (state.pausedUntil && Date.parse(state.pausedUntil) > Date.now()) lines.push(`Sending is paused after a failure until ${state.pausedUntil}.`);
  return lines;
}

/** What status says of an agent directory: its version, its port, who answers there, and how it has sent. */
async function agentLines(directory, version) {
  const agent = agentStatus(directory);
  const state = serviceState(serviceOf(directory));
  const lines = [];
  const service = agent.config?.service === false ? "none: join --no-service, so it sends only while the agent command runs" : state;
  lines.push(state === "without its node" ? "Agent service: its Node is gone (upgraded or removed?), so nothing is sent. Run join again." : `Agent service: ${service}.`);
  const port = agent.config ? ` on 127.0.0.1:${agent.config.port}, sending to ${agent.config.endpoint}` : ", without its settings";
  const fresh = agent.current ? `up to date with this package (${version})` : `version ${agent.version ?? "unknown"}, this package is ${version}: run join again to update it`;
  lines.push(`Agent: ${directory}${port}; ${fresh}${agent.key ? "" : "; its key is missing, so it sends nothing"}.`);
  if (agent.config) {
    const key = readKey(directory);
    const listener = await whoListens(agent.config.port, key);
    const stoppedPreview = listener === "none" && previewOf(directory)?.running === false;
    lines.push({
      agent: `The agent answers on 127.0.0.1:${agent.config.port}.`,
      preview: `A preview runs on 127.0.0.1:${agent.config.port}, in the agent's place: nothing is sent until it ends and starts the agent again.`,
      none: stoppedPreview
        ? `Nothing listens on 127.0.0.1:${agent.config.port}, so nothing is sent: a preview was stopped without starting the agent again. Run join again to start it.`
        : `Nothing listens on 127.0.0.1:${agent.config.port}, so nothing is sent.${agent.config.service === false ? " Run the agent command to send." : state === "not installed" ? "" : " Run join again to start it."}`,
      other: key
        ? `Another program listens on 127.0.0.1:${agent.config.port}, not the agent: the tools send to it, and the agent cannot start. Stop that program, or leave and join again for another port.`
        : `Something listens on 127.0.0.1:${agent.config.port}; without the agent's key, nothing tells whether it is the agent.`,
    }[listener]);
    lines.push(...stateLines(agent.state, agent.config.port));
  }
  return lines;
}

async function status() {
  const found = allSettingsFiles().map((file) => [file, readSettings(file)]).filter(([, current]) => current !== undefined && (current.writer !== "other" || current.others));
  const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const joined = found.some(([, current]) => current.writer === "joined");
  console.log(joined ? "Joined." : found.some(([, current]) => current.writer === "preview") ? "A preview is running, or was stopped without cleaning up." : "Not joined.");
  // This environment's agent, and any other this home's services run, as from a shell with another XDG_CONFIG_HOME.
  const directories = allAgentDirectories().filter((directory) => directory === agentDirectory || agentStatus(directory).present);
  for (const directory of directories) {
    if (directory === agentDirectory && !agentStatus(directory).present) {
      const state = serviceState(service);
      console.log(state === "without its node" ? "Agent service: its Node is gone (upgraded or removed?), so nothing is sent. Run join again." : `Agent service: ${state}.`);
      if (joined && directories.length === 1) console.log("Agent: missing, so nothing is sent. Run join again.");
      continue;
    }
    for (const line of await agentLines(directory, version)) console.log(line);
  }
  if (joined) {
    for (const file of files) {
      if (readSettings(file)?.writer !== "joined") console.log(`${file}: no block of ours, so the tool that reads it sends nothing. Run join again.`);
    }
  }
  for (const [file, current] of found) {
    const who = { joined: "joined", preview: "a preview", "by hand": "written by hand", other: "settings of your own" }[current.writer];
    const own = ownSettingNames(current.writer === "other" ? current.text : current.outside);
    const lines = [...(current.block ? [current.block.trimEnd()] : []), ...(own.length > 0 ? [`settings of your own, values not shown: ${own.join(", ")}`] : [])];
    console.log(`\n${file} (${who}):\n${lines.join("\n")}`);
  }
}

async function preview() {
  const stop = new AbortController();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(name, () => stop.abort());
  const { filter } = await import(packaged["telemetry-transform.mjs"].href);
  const config = readAgentConfig(agentDirectory);
  const key = readKey(agentDirectory);
  // Joined, the preview takes the agent's place on its port, so that what the tools already running send shows too, and nothing is sent meanwhile.
  const joined = config !== undefined && key !== undefined && (config.service === false || serviceState(service) !== "not installed");
  if (joined) {
    const listener = await whoListens(config.port, key);
    if (listener === "preview") fail(`A preview already runs on 127.0.0.1:${config.port}, in the agent's place.`);
    if (listener === "other") fail(`Another program listens on 127.0.0.1:${config.port}, the agent's port: stop it first.`);
    if (listener === "agent" && !(await stopAgent(config.port, key))) fail("The agent did not stop: nothing is previewed. Try again in a moment.");
  }
  let started;
  try {
    started = await startPreview({ files: joined ? [] : files, filter, key, print: (line) => console.log(line), signal: stop.signal, port: joined ? config.port : undefined });
  } catch (error) {
    if (joined) startService(service);
    throw error;
  }
  clearReachability([started.port]);
  // Killed before it starts the agent again, the preview leaves this behind for status and join to tell.
  if (joined) fs.writeFileSync(previewMark(agentDirectory), `${JSON.stringify({ pid: process.pid, port: started.port })}\n`, { mode: 0o600 });
  console.log(joined
    ? `Previewing on 127.0.0.1:${started.port}, the agent's port, sending nothing: the agent is stopped until the preview ends. Use the Pharo tools: what the agent would send is printed here. Ctrl-C ends the preview${config.service === false ? "" : " and starts the agent again"}.\n`
    : `Previewing on 127.0.0.1:${started.port}, sending nothing. Restart your agent host, and any image you started yourself, then use the Pharo tools: what the agent would send is printed here. Ctrl-C ends the preview and puts your settings back.\n`);
  await started.done;
  if (joined) {
    // Not when leave ran meanwhile: there is no service of this home's to start any more.
    if (config.service === false) console.log("The agent is not started again: no service runs it. Run the agent command to send.");
    else console.log(startService(service) ? "The agent runs again." : "The agent is not started again: its service is gone.");
    fs.rmSync(previewMark(agentDirectory), { force: true });
  }
}

async function agent() {
  if (readAgentConfig(agentDirectory) === undefined) fail("No agent is installed: run join first.");
  await runAgent(agentDirectory);
}

if (values.help || command === undefined) {
  console.log(usage);
} else if (command === "join") {
  await join();
} else if (command === "leave") {
  await leave();
} else if (command === "status") {
  await status();
} else if (command === "preview") {
  await preview();
} else if (command === "agent") {
  await agent();
} else {
  fail(usage);
}
