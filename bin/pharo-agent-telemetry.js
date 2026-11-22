#!/usr/bin/env node
// Join, preview or leave the Pharo agent tools' field telemetry.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";
import { runAgent } from "../src/agent.js";
import { missingForJoin, publicEndpoint, publicToken } from "../src/collector.js";
import { agentStatus, freePort, installAgent, packaged, readAgentConfig, readKey, removeAgent } from "../src/install.js";
import { recoverPreview, startPreview } from "../src/preview.js";
import { dryRun, installService, removeService, runCommand, serviceState } from "../src/service.js";
import {
  agentSettings, agentTool, backupSuffix, configDirectory, everyAgentDirectory, everySettingsFile, readSettings, removeSettings, settingsBlock, settingsFiles, writeSettings,
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
  --force            Replace OpenTelemetry settings you wrote yourself.
Options for leave:
  --force            Remove each settings file whole, settings of your own in it included.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    endpoint: { type: "string" },
    token: { type: "string" },
    force: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const [command] = positionals;
const files = settingsFiles();
const agentDirectory = configDirectory(agentTool);
const agentPath = path.join(agentDirectory, "agent.mjs");
// A test sets PHARO_AGENT_TELEMETRY_DRY_RUN to a file: the service commands
// are written there instead of run, and nothing is installed.
const run = process.env.PHARO_AGENT_TELEMETRY_DRY_RUN ? dryRun(process.env.PHARO_AGENT_TELEMETRY_DRY_RUN) : runCommand;
const service = { agent: agentPath, run };

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Whether something answers on a loopback port, within `wait` milliseconds. */
async function listening(port, wait) {
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    if (open) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function join() {
  const endpoint = values.endpoint ?? publicEndpoint;
  const token = values.token ?? (values.endpoint ? undefined : publicToken);
  const missing = values.endpoint ? [] : missingForJoin();
  if (missing.length > 0) fail(`The project's collector is not ready: its ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set yet. Give --endpoint to send to another one.`);
  for (const file of files) {
    const current = readSettings(file);
    if (current?.writer === "preview") fail("A preview is running. Stop it first.");
    if (current?.others && !values.force) fail(`${file} holds OpenTelemetry settings this command did not write. Run join --force to replace them.`);
  }
  const port = readAgentConfig(agentDirectory)?.port ?? (await freePort());
  installAgent(agentDirectory, { port, endpoint, token });
  installService(service);
  for (const file of files) writeSettings(file, settingsBlock("joined", agentSettings({ port })));
  console.log(`Joined: the Pharo tools send their traces to the agent on 127.0.0.1:${port}, which keeps only what the participants page lists and sends it to ${endpoint}.`);
  if (!process.env.PHARO_AGENT_TELEMETRY_DRY_RUN && !(await listening(port, 5_000))) {
    console.log("The agent does not answer yet: run status in a moment.");
  }
  console.log("Tools already running start sending once they restart, and images made before now send nothing until they are made again.");
  console.log(`Agent: ${agentDirectory}`);
  for (const file of files) console.log(`Settings: ${file}`);
}

function leave() {
  for (const file of everySettingsFile()) {
    recoverPreview(file);
    fs.rmSync(`${file}${backupSuffix}`, { force: true });
    // A file without a block of ours is someone else's: left as it is.
    const current = readSettings(file);
    if (current === undefined || current.writer === "other") continue;
    if (removeSettings(file, { force: values.force }) === "kept others") {
      console.log(`Removed the block from ${file}; the settings of your own in it stay.`);
    } else {
      console.log(`Removed ${file}.`);
    }
  }
  const hadService = removeService(service);
  const removed = everyAgentDirectory().flatMap((directory) => removeAgent(directory));
  if (hadService || removed.length > 0) console.log(`Stopped and removed the agent, its files and its key.`);
  console.log("Left: sending stops at once. PLexus and the images now find the agent's port closed, and nothing else leaves this machine. Images keep running.");
}

function status() {
  const found = everySettingsFile().map((file) => [file, readSettings(file)]).filter(([, current]) => current !== undefined && (current.writer !== "other" || current.others));
  const agent = agentStatus(agentDirectory);
  const state = serviceState(service);
  const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const joined = found.some(([, current]) => current.writer === "joined");
  console.log(joined ? "Joined." : found.some(([, current]) => current.writer === "preview") ? "A preview is running, or was stopped without cleaning up." : "Not joined.");
  console.log(`Agent service: ${state}.`);
  if (agent.present) {
    const port = agent.config ? ` on 127.0.0.1:${agent.config.port}, sending to ${agent.config.endpoint}` : ", without its settings";
    const fresh = agent.current ? `up to date with this package (${version})` : `version ${agent.version ?? "unknown"}, this package is ${version}: run join again to update it`;
    console.log(`Agent: ${agentDirectory}${port}; ${fresh}${agent.key ? "" : "; its key is missing, so it sends nothing"}.`);
  } else if (joined) {
    console.log("Agent: missing, so nothing is sent. Run join again.");
  }
  if (joined) {
    for (const file of files) {
      if (readSettings(file)?.writer !== "joined") console.log(`${file}: no block of ours, so the tool that reads it sends nothing. Run join again.`);
    }
  }
  for (const [file, current] of found) {
    const who = { joined: "joined", preview: "a preview", "by hand": "written by hand", other: "settings of your own" }[current.writer];
    console.log(`\n${file} (${who}${current.writer !== "other" && current.others ? ", with settings of your own" : ""}):\n${current.text.trimEnd()}`);
  }
}

async function preview() {
  const stop = new AbortController();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(name, () => stop.abort());
  const { filter } = await import(packaged["telemetry-transform.mjs"].href);
  const { port, done } = await startPreview({ files, filter, key: readKey(agentDirectory), print: (line) => console.log(line), signal: stop.signal });
  console.log(`Previewing on 127.0.0.1:${port}, sending nothing. Start a new agent session and use the Pharo tools: what the agent would send is printed here. Ctrl-C ends the preview and puts your settings back.\n`);
  await done;
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
  leave();
} else if (command === "status") {
  status();
} else if (command === "preview") {
  await preview();
} else if (command === "agent") {
  await agent();
} else {
  fail(usage);
}
